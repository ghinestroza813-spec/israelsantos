require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
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

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "israel-santos-thaishop-api",
    timestamp: new Date().toISOString(),
    integrations: { supabaseConfigured }
  });
});

app.get("/health/database", async (_req, res) => {
  if (!supabase) {
    return res.status(503).json({
      status: "not_configured",
      message: "Configure SUPABASE_URL and SUPABASE_SECRET_KEY on the server."
    });
  }

  try {
    const { error } = await supabase.from("products").select("id").limit(1);
    if (error) throw error;
    return res.status(200).json({ status: "connected", database: "supabase" });
  } catch (error) {
    console.error("Supabase health check failed:", error.message);
    return res.status(503).json({
      status: "unavailable",
      message: "Database connection or schema check failed."
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Israel Santos Thaishop API listening on port ${port}`);
});
