// backend/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const rateLimit = require("express-rate-limit");

// Import your route handlers
const authRoute = require("./controllers/auth");
const usersRoute = require("./controllers/users");
const cardsRoute = require("./controllers/cards");
const notificationsRoute = require("./controllers/notifications");
const subscriptionsRoute = require("./controllers/subscriptions");
const aiChatRoute = require("./controllers/chat");
const sessionsRoute = require("./controllers/chats");
const { webhookHandler, paymentsRouter } = require("./controllers/payments");

const requireAuth = require("./middleware/requireAuth");

const app = express();

/* ────────────────────────────────────────────────────────────────── */
/* 0) Trust proxy (for secure cookies behind SSL proxies)             */
/* ────────────────────────────────────────────────────────────────── */
app.set("trust proxy", 1);

/* ────────────────────────────────────────────────────────────────── */
/* 1) Load & validate essential environment variables                 */
/* ────────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 4000;

// FRONTEND_ORIGIN must be set in production (e.g. "https://dentgo-f.vercel.app")
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
if (!FRONTEND_ORIGIN) {
  console.error("❌  Missing FRONTEND_ORIGIN in environment");
  process.exit(1);
}

// We also allow "https://dentgo.io" (if you host a second domain), plus any preview under dentgo-*.vercel.app
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  "https://dentgo.io",
];
const VERCEL_REGEX = /^https:\/\/dentgo.*\.vercel\.app$/;

/* ────────────────────────────────────────────────────────────────── */
/* 2) Generic middleware                                              */
/* ────────────────────────────────────────────────────────────────── */
app.use(morgan("dev"));

// Simple logger to show incoming Origin & Cookies
app.use((req, res, next) => {
  console.log(`Incoming Origin: ${req.headers.origin}`);
  console.log(`Incoming Cookies:`, req.headers.cookie);
  next();
});

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, Postman)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin) || VERCEL_REGEX.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,                    // <–– must be true to send/receive cookies
    allowedHeaders: ["Content-Type"],     // Only need Content-Type for JSON bodies
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Parse incoming cookies
app.use(cookieParser());

/* ────────────────────────────────────────────────────────────────── */
/* 3) Stripe Webhook – raw body for signature verification            */
/* ────────────────────────────────────────────────────────────────── */
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);

/* ────────────────────────────────────────────────────────────────── */
/* 4) JSON parsing (all other routes)                                */
/* ────────────────────────────────────────────────────────────────── */
app.use(express.json());

/* ────────────────────────────────────────────────────────────────── */
/* 5) Passport (Apple / Google OAuth)                                 */
/* ────────────────────────────────────────────────────────────────── */
app.use(passport.initialize());

/* ────────────────────────────────────────────────────────────────── */
/* 6) Public auth routes                                              */
/* ────────────────────────────────────────────────────────────────── */
app.use("/api/auth", authRoute);

/* ────────────────────────────────────────────────────────────────── */
/* 7) Protected payments (all except webhook)                         */
/* ────────────────────────────────────────────────────────────────── */
app.use("/api/payments", requireAuth, paymentsRouter);

/* ────────────────────────────────────────────────────────────────── */
/* 8) Other protected routes                                           */
/* ────────────────────────────────────────────────────────────────── */
app.use("/api/users", requireAuth, usersRoute);
app.use("/api/cards", requireAuth, cardsRoute);
app.use("/api/notifications", requireAuth, notificationsRoute);
app.use("/api/subscriptions", requireAuth, subscriptionsRoute);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Too many requests – please slow down." },
});
app.use("/api/chat", requireAuth, chatLimiter, aiChatRoute);
app.use("/api/chats", requireAuth, sessionsRoute);

/* ────────────────────────────────────────────────────────────────── */
/* 9) Health‐check / root                                              */
/* ────────────────────────────────────────────────────────────────── */
app.get("/api/ping", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => {
  res.send("🚀 DentGo Backend is live!");
});

/* ────────────────────────────────────────────────────────────────── */
/* 10) Global error handler                                           */
/* ────────────────────────────────────────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (err.message && err.message.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

/* ────────────────────────────────────────────────────────────────── */
/* 11) Start server                                                   */
/* ────────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
