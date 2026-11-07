require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { z } = require("zod");
const path = require("node:path");

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseSecretKey);
const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
// Verify end-user JWTs with the public Auth client; reserve the secret key for server-side database operations.
const supabaseAuth = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

app.disable("x-powered-by");
// Render runs the app behind one trusted reverse proxy.
app.set("trust proxy", 1);
// Browser authentication connects directly to this configured Supabase origin.
// All other Helmet CSP defaults remain enabled.
const authOrigin = (() => {
  try { return supabaseUrl ? new URL(supabaseUrl).origin : null; }
  catch { return null; }
})();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "connect-src": ["'self'", ...(authOrigin ? [authOrigin] : [])]
    }
  }
}));
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
app.use(express.json({ limit: "8mb" }));
// Standalone secure stock console; the legacy storefront admin remains unchanged.
app.use("/stock-admin", express.static(path.join(__dirname, "../public/stock-admin"), { index: "index.html" }));
app.get("/api/admin-auth-config", (_req, res) => {
  if (!process.env.SUPABASE_ANON_KEY || !supabaseUrl) return res.status(503).json({ error: "Public Supabase Auth configuration missing." });
  res.json({ supabaseUrl, anonKey: process.env.SUPABASE_ANON_KEY });
});
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

    if (!supabaseAuth) return res.status(503).json({ error: "Authentication configuration missing." });
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData?.user) {
      // Log only the diagnostic code/status, never the JWT or other session credentials.
      console.error("Admin token verification failed:", {
        code: authError?.code || "no_user",
        status: authError?.status || null
      });
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
  is_active: z.boolean().optional().default(false),
  needs_review: z.boolean().optional().default(true),
  is_featured: z.boolean().optional().default(false),
  badge: z.string().max(100).optional().nullable(),
  stock: z.number().int().nonnegative().optional().nullable(),
  installments: z.number().int().min(1).max(24).optional().nullable(),
  sort_order: z.number().int().optional().default(0)
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

// Upload one product image from the trusted Google Apps Script integration.
app.post("/api/integrations/sheets/images", requireSupabase, async (req, res) => {
  const configuredSecret = process.env.CATALOG_SYNC_SECRET;
  const suppliedSecret = req.get("x-catalog-sync-secret");
  if (!configuredSecret) return res.status(503).json({ error: "Catalog sync is not configured." });
  if (!suppliedSecret || suppliedSecret.length !== configuredSecret.length ||
      !require("crypto").timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
    return res.status(401).json({ error: "Invalid integration credentials." });
  }

  const input = z.object({
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(1).max(7_000_000)
  }).strict().safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid image upload data." });

  try {
    const bytes = Buffer.from(input.data.base64, "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString("base64").replace(/=+$/, "") !== input.data.base64.replace(/=+$/, "")) {
      return res.status(413).json({ error: "Image must be valid base64 and no larger than 5 MB." });
    }
    const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[input.data.mimeType];
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "israel santos";
    const objectPath = `products/${require("crypto").randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, bytes, {
      contentType: input.data.mimeType,
      cacheControl: "31536000",
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    return res.status(201).json({ image_url: data.publicUrl, path: objectPath, bucket });
  } catch (error) {
    console.error("Google Sheets image upload failed:", error.message);
    return res.status(500).json({ error: "Could not upload product image to storage." });
  }
});

// Google Sheets intake: shared secret is stored only in Render environment variables.
// This endpoint INSERTS new products as inactive/pending review; it never updates existing rows.
app.post("/api/integrations/sheets/products", requireSupabase, async (req, res) => {
  const configuredSecret = process.env.CATALOG_SYNC_SECRET;
  const suppliedSecret = req.get("x-catalog-sync-secret");
  if (!configuredSecret) return res.status(503).json({ error: "Catalog sync is not configured." });
  if (!suppliedSecret || suppliedSecret.length !== configuredSecret.length ||
      !require("crypto").timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
    return res.status(401).json({ error: "Invalid integration credentials." });
  }

  const sheetProductInput = z.object({
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
    stock: z.number().int().nonnegative().optional().nullable(),
    installments: z.number().int().min(1).max(24).optional().nullable()
  }).strict();
  const parsed = sheetProductInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product data.", details: parsed.error.flatten() });

  try {
    const { data: slugMatch, error: slugError } = await supabase
      .from("products").select("id").eq("slug", parsed.data.slug).limit(1);
    if (slugError) throw slugError;
    let skuMatch = [];
    if (parsed.data.sku) {
      const { data, error } = await supabase
        .from("products").select("id").eq("sku", parsed.data.sku).limit(1);
      if (error) throw error;
      skuMatch = data || [];
    }
    if ((slugMatch && slugMatch.length) || skuMatch.length) {
      return res.status(409).json({ error: "Product with this slug or SKU already exists; no changes were made." });
    }

    const { data, error } = await supabase.from("products").insert({
      ...parsed.data,
      is_active: false,
      needs_review: true,
      is_featured: false
    }).select("id, slug, name, is_active, needs_review").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Duplicate slug or SKU; no changes were made." });
      throw error;
    }
    await recordProductActivity(data.id, req.admin.id, "created", { source: "site_admin" });
    await syncProductReport(data, "created");
    return res.status(201).json({ product: data, status: "pending_approval" });
  } catch (error) {
    console.error("Google Sheets catalog intake failed:", error.message);
    return res.status(500).json({ error: "Could not receive catalog product." });
  }
});

// Approval/publication controlled by the protected Google Sheets approval column.
app.post("/api/integrations/sheets/products/decision", requireSupabase, async (req, res) => {
  const configuredSecret = process.env.CATALOG_SYNC_SECRET;
  const suppliedSecret = req.get("x-catalog-sync-secret");
  if (!configuredSecret) return res.status(503).json({ error: "Catalog sync is not configured." });
  if (!suppliedSecret || suppliedSecret.length !== configuredSecret.length ||
      !require("crypto").timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
    return res.status(401).json({ error: "Invalid integration credentials." });
  }
  const parsed = z.object({
    slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    sku: z.string().trim().min(1).max(80),
    decision: z.enum(["Aprovado", "Rejeitado"])
  }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid approval decision." });
  try {
    const { data: existing, error: lookupError } = await supabase
      .from("products").select("id, slug, sku").eq("slug", parsed.data.slug).eq("sku", parsed.data.sku).eq("is_active", false).eq("needs_review", true).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ error: "Matching pending product not found. No changes made." });
    const approved = parsed.data.decision === "Aprovado";
    const { data, error } = await supabase.from("products")
      .update({ is_active: approved, needs_review: false })
      .eq("id", existing.id)
      .select("id, slug, sku, is_active, needs_review").single();
    if (error) throw error;
    return res.json({ product: data, decision: parsed.data.decision, published: approved });
  } catch (error) {
    console.error("Google Sheets approval decision failed:", error.message);
    return res.status(500).json({ error: "Could not apply approval decision." });
  }
});

// Public catalog: only active products and only storefront-safe columns.
app.get("/api/products", requireSupabase, async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24;
    const { data, error } = await supabase
      .from("products")
      .select("id, slug, name, description, brand, category, price, compare_at_price, sku, image_url, images, sizes, is_featured, created_at")
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
function requireOwner(req, res, next) {
  if (!req.admin || req.admin.role !== "admin") return res.status(403).json({ error: "Only the store owner can approve or publish products." });
  next();
}

async function recordProductActivity(productId, actorUserId, action, details) {
  try {
    const { error } = await supabase.from("product_activity_log").insert({
      product_id: productId, actor_user_id: actorUserId, action, details: details || {}
    });
    if (error) console.error("Product activity log failed:", error.message);
  } catch (error) {
    console.error("Product activity log failed:", error.message);
  }
}

// Google Sheets reporting webhook. Never log the webhook URL, secret, or product data.
async function syncProductReport(product, action) {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!webhook || !secret) {
    console.error("Google Sheets sync skipped: missing webhook configuration.", {
      hasUrl: Boolean(webhook), hasSecret: Boolean(secret)
    });
    return { ok: false, reason: "missing_configuration" };
  }
  try {
    console.log("Google Sheets sync started:", action, product && product.id);
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, product })
    });
    const responseText = await response.text();
    console.log("Google Sheets sync response:", response.status, responseText.slice(0, 500));
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, status: response.status, response: responseText.slice(0, 500) };
  } catch (error) {
    console.error("Google Sheets report sync failed:", error.message);
    return { ok: false, reason: error.message };
  }
}

app.post("/api/admin/uploads/product-image", requireSupabase, requireAdmin, async (req, res) => {
  const input = z.object({ fileName: z.string().trim().min(1).max(180), mimeType: z.enum(["image/jpeg","image/png","image/webp"]), base64: z.string().min(1).max(7_000_000) }).strict().safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Invalid image upload." });
  try {
    const bytes = Buffer.from(input.data.base64, "base64");
    if (!bytes.length || bytes.length > 5*1024*1024 || bytes.toString("base64").replace(/=+$/,"") !== input.data.base64.replace(/=+$/,"")) return res.status(413).json({ error: "Image must be valid base64 and no larger than 5 MB." });
    const ext = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp" })[input.data.mimeType];
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "israel santos";
    const objectPath = `products/${require("crypto").randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(objectPath, bytes, { contentType: input.data.mimeType, cacheControl: "31536000", upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    return res.status(201).json({ image_url: data.publicUrl, path: objectPath });
  } catch (error) {
    console.error("Admin image upload failed:", error.message);
    return res.status(500).json({ error: "Could not upload product image." });
  }
});

app.post("/api/admin/products/:id/review", requireSupabase, requireAdmin, requireOwner, async (req, res) => {
  const parsed = z.object({ decision: z.enum(["approve","reject"]), review_notes: z.string().max(1000).optional().default("") }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid review decision." });
  try {
    const approved = parsed.data.decision === "approve";
    const { data, error } = await supabase.from("products").update({
      is_active: approved, needs_review: false, reviewed_by: req.admin.id,
      reviewed_at: new Date().toISOString(), review_notes: parsed.data.review_notes
    }).eq("id", req.params.id).eq("is_active", false).eq("needs_review", true)
      .select("id, slug, name, sku, brand, category, price, stock, image_url, is_active, needs_review, reviewed_at, reviewed_by").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "Product is not pending review; no changes made." });
    await recordProductActivity(data.id, req.admin.id, approved ? "approved" : "rejected", { notes: parsed.data.review_notes });
    await syncProductReport(data, approved ? "approved" : "rejected");
    return res.json({ product: data, published: approved });
  } catch (error) {
    console.error("Product review failed:", error.message);
    return res.status(500).json({ error: "Could not apply product review." });
  }
});


// Protected admin catalog: includes inactive products awaiting review.
app.get("/api/admin/products", requireSupabase, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, slug, name, description, brand, category, price, compare_at_price, sku, image_url, images, sizes, is_active, is_featured, badge, stock, installments, sort_order, needs_review, created_by, reviewed_by, reviewed_at, review_notes")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return res.json({ products: data || [] });
  } catch (error) {
    console.error("Admin catalog query failed:", error.message);
    return res.status(503).json({ error: "Admin catalog is temporarily unavailable." });
  }
});

// Stage 5B: create one inactive variant without allocating legacy stock.
// Only the store owner may create variants. Activation and batch creation are separate steps.
const createVariantInput = z.object({
  sku: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  size: z.string().trim().min(1).max(40).optional().nullable(),
  color: z.string().trim().min(1).max(60).optional().nullable(),
  label: z.string().trim().min(1).max(120).optional().nullable(),
  price_override: z.number().finite().nonnegative().optional().nullable()
}).strict().refine((value) => Boolean(value.size || value.color || value.label), {
  message: "Provide at least a size, color or label."
});

app.post("/api/admin/products/:id/variants", requireSupabase, requireAdmin, requireOwner, async (req, res) => {
  const productId = z.string().uuid().safeParse(req.params.id);
  const parsed = createVariantInput.safeParse(req.body);
  if (!productId.success || !parsed.success) {
    return res.status(400).json({
      error: "Invalid variant data.",
      details: parsed.success ? undefined : parsed.error.flatten()
    });
  }
  try {
    const { data: product, error: productError } = await supabase.from("products")
      .select("id").eq("id", productId.data).maybeSingle();
    if (productError) throw productError;
    if (!product) return res.status(404).json({ error: "Product not found." });

    const { data: variant, error } = await supabase.from("product_variants").insert({
      product_id: productId.data,
      sku: parsed.data.sku,
      size: parsed.data.size || null,
      color: parsed.data.color || null,
      label: parsed.data.label || null,
      price_override: parsed.data.price_override ?? null,
      stock: 0,
      reserved_quantity: 0,
      is_active: false
    }).select("id,product_id,sku,size,color,label,price_override,stock,reserved_quantity,is_active").single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Variant SKU already exists or variant conflicts with a unique constraint." });
      }
      throw error;
    }
    return res.status(201).json({ variant });
  } catch (error) {
    console.error("Variant creation failed:", error.message);
    return res.status(503).json({ error: "Could not create product variant." });
  }
});

// Stage 5A: inventory is tracked by variant; legacy products.stock is not rewritten.
const inventoryMovementInput = z.object({
  movement_type: z.enum(["purchase", "sale", "adjustment", "return", "loss"]),
  quantity_delta: z.number().int().refine((value) => value !== 0, "Quantity must not be zero"),
  reason: z.string().trim().min(1).max(500),
  reference: z.string().trim().max(120).optional().nullable(),
  idempotency_key: z.string().uuid()
}).strict();

// Read-only: show both variant stock and legacy product stock separately.
// Never sum these values, because legacy units may not yet be allocated to sizes.
app.get("/api/admin/products/:id/variants", requireSupabase, requireAdmin, async (req, res) => {
  const productId = z.string().uuid().safeParse(req.params.id);
  if (!productId.success) return res.status(400).json({ error: "Invalid product ID." });
  try {
    const { data: product, error: productError } = await supabase.from("products")
      .select("id,name,sku,stock,sizes,is_active").eq("id", productId.data).maybeSingle();
    if (productError) throw productError;
    if (!product) return res.status(404).json({ error: "Product not found." });
    const { data: variants, error } = await supabase.from("product_variants")
      .select("id,product_id,sku,size,color,label,price_override,stock,reserved_quantity,is_active,updated_at")
      .eq("product_id", productId.data).order("size", { ascending: true });
    if (error) throw error;
    return res.json({ product, variants: variants || [], legacy_stock_unallocated: product.stock });
  } catch (error) {
    console.error("Variant listing failed:", error.message);
    return res.status(503).json({ error: "Could not load product variants." });
  }
});

// Audit history is visible to authenticated store administrators only.
app.get("/api/admin/products/:id/inventory-movements", requireSupabase, requireAdmin, async (req, res) => {
  const productId = z.string().uuid().safeParse(req.params.id);
  if (!productId.success) return res.status(400).json({ error: "Invalid product ID." });
  try {
    const { data, error } = await supabase.from("inventory_movements")
      .select("id,product_id,variant_id,movement_type,quantity_delta,stock_before,stock_after,reason,reference,created_at")
      .eq("product_id", productId.data).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return res.json({ movements: data || [] });
  } catch (error) {
    console.error("Inventory history query failed:", error.message);
    return res.status(503).json({ error: "Could not load inventory history." });
  }
});

// Only the owner may move stock. Atomic stock update and audit log happen in
// the existing Supabase RPC, not in two separate HTTP/database operations.
app.post("/api/admin/variants/:id/movements", requireSupabase, requireAdmin, requireOwner, async (req, res) => {
  const variantId = z.string().uuid().safeParse(req.params.id);
  const parsed = inventoryMovementInput.safeParse(req.body);
  if (!variantId.success || !parsed.success) {
    return res.status(400).json({ error: "Invalid inventory movement.", details: parsed.success ? undefined : parsed.error.flatten() });
  }
  const delta = parsed.data.quantity_delta;
  const type = parsed.data.movement_type;
  if ((["sale", "loss"].includes(type) && delta >= 0) ||
      (["purchase", "return"].includes(type) && delta <= 0)) {
    return res.status(400).json({ error: "Movement quantity sign does not match movement type." });
  }
  try {
    const { data, error } = await supabase.rpc("apply_inventory_movement", {
      p_variant_id: variantId.data,
      p_movement_type: parsed.data.movement_type,
      p_quantity_delta: parsed.data.quantity_delta,
      p_reason: parsed.data.reason,
      p_reference: parsed.data.reference || null,
      p_idempotency_key: parsed.data.idempotency_key,
      p_actor_user_id: req.admin.id
    });
    if (error) {
      if (["23514", "P0002", "22023", "23505"].includes(error.code)) {
        return res.status(409).json({ error: "Movement rejected. Check stock, variant and idempotency key." });
      }
      throw error;
    }
    return res.status(200).json({ movement: data?.[0] || null });
  } catch (error) {
    console.error("Inventory movement failed:", error.message);
    return res.status(503).json({ error: "Could not apply inventory movement." });
  }
});

// First protected catalog write endpoint. Payment/order endpoints will be added separately.
app.post("/api/admin/products", requireSupabase, requireAdmin, async (req, res) => {
  const parsed = productInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product data.", details: parsed.error.flatten() });
  try {
    const { data, error } = await supabase.from("products").insert({
      ...parsed.data, is_active: false, needs_review: true, is_featured: false, created_by: req.admin.id
    }).select("id, slug, name, price, sku, brand, category, stock, image_url, is_active, needs_review, created_by").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Slug or SKU already exists." });
      throw error;
    }
    await recordProductActivity(data.id, req.admin.id, "created", { source: "site_admin" });
    void syncProductReport(data, "created");
    return res.status(201).json({ product: data, status: "pending_approval" });
  } catch (error) {
    console.error("Product submission failed:", error.message);
    return res.status(500).json({ error: "Could not submit product for approval." });
  }
});

// Update and delete operations are restricted to authenticated administrators.
app.patch("/api/admin/products/:id", requireSupabase, requireAdmin, async (req, res) => {
  const parsed = productInput.partial().strict().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) return res.status(400).json({ error: "Invalid product update.", details: parsed.success ? undefined : parsed.error.flatten() });
  try {
    const { data: current, error: readError } = await supabase.from("products").select("id,is_active,needs_review").eq("id", req.params.id).maybeSingle();
    if (readError) throw readError;
    if (!current) return res.status(404).json({ error: "Product not found." });
    if (req.admin.role !== "admin" && (current.is_active || !current.needs_review)) return res.status(403).json({ error: "Collaborators can edit pending products only." });
    if (req.admin.role !== "admin" && ("is_active" in parsed.data || "needs_review" in parsed.data || "is_featured" in parsed.data)) return res.status(403).json({ error: "Collaborators cannot change publication or review status." });
    const safeUpdate = { ...parsed.data };
    if (req.admin.role !== "admin") { delete safeUpdate.is_active; delete safeUpdate.needs_review; delete safeUpdate.is_featured; }
    const { data, error } = await supabase.from("products").update(safeUpdate).eq("id", req.params.id)
      .select("id,slug,name,sku,brand,category,price,stock,image_url,is_active,needs_review,created_by").maybeSingle();
    if (error) { if (error.code === "23505") return res.status(409).json({ error: "Slug or SKU already exists." }); throw error; }
    await recordProductActivity(data.id, req.admin.id, "updated", { source: "site_admin" });
    await syncProductReport(data, "updated");
    return res.json({ product: data });
  } catch (error) {
    console.error("Product update failed:", error.message);
    return res.status(500).json({ error: "Could not update product." });
  }
});

app.delete("/api/admin/products/:id", requireSupabase, requireAdmin, async (req, res) => {
  try {
    let query = supabase.from("products").delete().eq("id", req.params.id);
    if (req.admin.role !== "admin") query = query.eq("is_active", false).eq("needs_review", true);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Product not found or not eligible for collaborator deletion." });
    return res.status(200).json({ deleted: true, id: data.id });
  } catch (error) {
    console.error("Product deletion failed:", error.message);
    return res.status(500).json({ error: "Could not delete product." });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Israel Santos Thaishop API listening on port ${port}`);
});
