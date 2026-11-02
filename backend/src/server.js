require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { z } = require("zod");

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseSecretKey);
const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

function requireSupabase(_req, res, next) {
  if (!supabase) {
    return res.status(503).json({ error: "Database integration is not configured." });
  }
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;
    if (!token) return res.status(401).json({ error: "Authentication required." });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id, role")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (adminError) throw adminError;
    if (!admin) return res.status(403).json({ error: "Administrator access required." });

    req.admin = { id: authData.user.id, role: admin.role };
    next();
  } catch (error) {
    console.error("Admin authentication failed:", error.message);
    return res.status(500).json({ error: "Could not validate administrator access." });
  }
}

const productInput = z.object({
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(180),
  description: z.string().max(5000).optional().default(""),
  brand: z.string().max(100).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  price: z.number().nonnegative(),
  compare_at_price: z.number().nonnegative().optional().nullable(),
  sku: z.string().max(80).optional().nullable(),
  image_url: z.string().url().optional().nullable(),
  images: z.array(z.string().url()).max(20).optional().default([]),
  sizes: z.array(z.string().max(40)).max(30).optional().default([]),
  is_active: z.boolean().optional().default(true),
  is_featured: z.boolean().optional().default(false)
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "israel-santos-thaishop-api",
    timestamp: new Date().toISOString(),
    integrations: { supabaseConfigured }
  });
});

app.get("/health/database", requireSupabase, async (_req, res) => {
  try {
    const { error } = await supabase.from("products").select("id").limit(1);
    if (error) throw error;
    return res.status(200).json({ status: "connected", database: "supabase" });
  } catch (error) {
    console.error("Supabase health check failed:", error.message);
    return res.status(503).json({ status: "unavailable", message: "Database connection or schema check failed." });
  }
});

// Public catalog: only active products and only storefront-safe columns.
app.get("/api/products", requireSupabase, async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24;
    const { data, error } = await supabase
      .from("products")
      .select("id, slug, name, description, brand, category, price, compare_at_price, sku, image_url, images, sizes, is_featured")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json({ products: data || [] });
  } catch (error) {
    console.error("Public catalog query failed:", error.message);
    return res.status(503).json({ error: "Catalog is temporarily unavailable." });
  }
});

app.get("/api/products/:slug", requireSupabase, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, slug, name, description, brand, category, price, compare_at_price, sku, image_url, images, sizes, is_featured")
      .eq("slug", req.params.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Product not found." });
    return res.json({ product: data });
  } catch (error) {
    console.error("Product query failed:", error.message);
    return res.status(503).json({ error: "Product is temporarily unavailable." });
  }
});

// Protected admin identity check; admin must already exist in public.admin_users.
app.get("/api/admin/me", requireSupabase, requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

// First protected catalog write endpoint. Payment/order endpoints will be added separately.
app.post("/api/admin/products", requireSupabase, requireAdmin, async (req, res) => {
  const parsed = productInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid product data.", details: parsed.error.flatten() });
  }
  try {
    const { data, error } = await supabase
      .from("products")
      .insert(parsed.data)
      .select("id, slug, name, price, is_active")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Slug or SKU already exists." });
      throw error;
    }
    return res.status(201).json({ product: data });
  } catch (error) {
    console.error("Product creation failed:", error.message);
    return res.status(500).json({ error: "Could not create product." });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Israel Santos Thaishop API listening on port ${port}`);
});
