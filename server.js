// backend/server.js
require("dotenv").config({ override: true });

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const rateLimit = require("express-rate-limit");

// import our routes
const authRoute = require("./controllers/auth");
const usersRoute = require("./controllers/users");
const cardsRoute = require("./controllers/cards");
const notificationsRoute = require("./controllers/notifications");
const subscriptionsRoute = require("./controllers/subscriptions");
const aiChatRoute = require("./controllers/chat");
const sessionsRoute = require("./controllers/chats");

// NOTE: paymentsRoute now exports { webhookHandler, paymentsRouter }
const { webhookHandler, paymentsRouter } = require("./controllers/payments");

const requireAuth = require("./middleware/requireAuth");

const app = express();

/* ────────────────────────────────────────────────────────────────── */
/* 0) Trust proxy (for secure cookies behind SSL proxies)             */
/* ────────────────────────────────────────────────────────────────── */
app.set("trust proxy", 1); // trust first proxy

/* ────────────────────────────────────────────────────────────────── */
/* 1) Allowed Frontend Origins                                        */
/* ────────────────────────────────────────────────────────────────── */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://dentgo-f.vercel.app";

const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  "https://dentgo.io",
  "https://dentgo-f.vercel.app",
];

// Regex to allow any preview URL under dentgo-*.vercel.app
const VERCEL_REGEX = /^https:\/\/dentgo.*\.vercel\.app$/;

/* ────────────────────────────────────────────────────────────────── */
/* 2) Generic middleware                                              */
/* ────────────────────────────────────────────────────────────────── */
app.use(morgan("dev"));

app.use((req, res, next) => {
  console.log(`Incoming Origin: ${req.headers.origin}`);
  console.log(`Incoming Cookies:`, req.headers.cookie);
  next();
});

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
    credentials: true,
    allowedHeaders: ["Content-Type"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

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
/* 7) Protected payments (all except webhook)                          */
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
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests – please slow down." },
});
app.use("/api/chat", requireAuth, chatLimiter, aiChatRoute);
app.use("/api/chats", requireAuth, sessionsRoute);

/* ────────────────────────────────────────────────────────────────── */
/* 9) Health‐check                                                     */
/* ────────────────────────────────────────────────────────────────── */
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

/* ────────────────────────────────────────────────────────────────── */
/* 9.5) Root route                                                     */
/* ────────────────────────────────────────────────────────────────── */
app.get("/", (_req, res) => {
  res.send("🚀 DentGo Backend is live!");
});

/* ────────────────────────────────────────────────────────────────── */
/* 10) Global error handler                                            */
/* ────────────────────────────────────────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (err.message && err.message.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

/* ────────────────────────────────────────────────────────────────── */
/* 11) Start server                                                    */
/* ────────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀  Server running on http://localhost:${PORT}`);
});
