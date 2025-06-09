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

// 0) Trust proxy (for secure cookies behind SSL proxies)
app.set("trust proxy", 1);

// 1) Validate essential env vars
const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
if (!FRONTEND_ORIGIN) {
  console.error("❌  Missing FRONTEND_ORIGIN in environment");
  process.exit(1);
}

const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  "https://dentgo.io",
  "http://localhost:3000",
];
const VERCEL_REGEX = /^https:\/\/dentgo.*\.vercel\.app$/;

// 2) Logging & CORS
app.use(morgan("dev"));
app.use((req, res, next) => {
  console.log(`Incoming Origin: ${req.headers.origin}`);
  console.log(`Cookies:`, req.headers.cookie);
  next();
});
app.use(
  cors({
    origin: (origin, cb) => {
      // allow requests with no origin (e.g. mobile apps, curl)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || VERCEL_REGEX.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,                // <-- allow cookies to be sent
    methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    exposedHeaders: ["Set-Cookie"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  })
);

// 3) Cookies & JSON
app.use(cookieParser());
app.use(express.json());

// 4) Stripe webhook (raw body)
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler
);

// 5) Passport
app.use(passport.initialize());

// 6) Public auth routes
app.use("/api/auth", authRoute);

// 7) Protected payments
app.use("/api/payments", requireAuth, paymentsRouter);

// 8) Other protected
app.use("/api/users", requireAuth, usersRoute);
app.use("/api/cards", requireAuth, cardsRoute);
app.use("/api/notifications", requireAuth, notificationsRoute);
app.use("/api/subscriptions", requireAuth, subscriptionsRoute);

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: "Too many requests – please slow down." },
});
app.use("/api/chat", requireAuth, chatLimiter, aiChatRoute);
app.use("/api/chats", requireAuth, sessionsRoute);

// 9) Health‐check / root
app.get("/api/ping", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) =>
  res.send("🚀 DentGo Backend is live!")
);

// 10) Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: "Internal Server Error" });
});

// 11) Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
