require('dotenv').config({ override: true });

const express      = require('express');
const cors         = require('cors');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const passport     = require('passport');
const rateLimit    = require('express-rate-limit');

const authRoute          = require('./controllers/auth');
const usersRoute         = require('./controllers/users');
const cardsRoute         = require('./controllers/cards');
const notificationsRoute = require('./controllers/notifications');
const subscriptionsRoute = require('./controllers/subscriptions');
const aiChatRoute        = require('./controllers/chat');
const sessionsRoute      = require('./controllers/chats');
const paymentsRoute      = require('./controllers/payments');
const requireAuth        = require('./middleware/requireAuth');

const app = express();

/* ------------------------------------------------------------------ */
/* 0) Allowed Frontend Origins                                         */
/* ------------------------------------------------------------------ */
// You said your frontend is hosted at: https://dentgo-f.vercel.app
// Ensure this matches exactly (no trailing slash).
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://dentgo-f.vercel.app';

const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  // If you have any preview URLs or additional domains, add them here:
  // 'https://preview-dentgo.vercel.app',
];

/* ------------------------------------------------------------------ */
/* 1) Generic middleware                                              */
/* ------------------------------------------------------------------ */
app.use(morgan('dev'));

app.use(
  cors({
    origin: (incomingOrigin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman).
      if (!incomingOrigin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(incomingOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin "${incomingOrigin}" not allowed`));
    },
    credentials: true,
    allowedHeaders: ['Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  })
);

// We still need express.json() for all JSON bodies except Stripe webhooks.
// Because the Stripe webhook uses raw body, we will mount it before express.json().
app.use(cookieParser());

/* ------------------------------------------------------------------ */
/* 2) Stripe Webhook must parse raw body so signature can be verified  */
/* ------------------------------------------------------------------ */
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  paymentsRoute
);

/* ------------------------------------------------------------------ */
/* 3) Now mount express.json() for all other routes                   */
/* ------------------------------------------------------------------ */
app.use(express.json());
// (No need for a “verify” callback here, since the webhook is handled above.)

/* ------------------------------------------------------------------ */
/* 4) Passport (Apple OAuth)                                          */
/* ------------------------------------------------------------------ */
app.use(passport.initialize());

/* ------------------------------------------------------------------ */
/* 5) Public auth routes                                              */
/* ------------------------------------------------------------------ */
app.use('/api/auth', authRoute);

/* ------------------------------------------------------------------ */
/* 6) Protected payments routes (everything _except_ webhook)         */
/* ------------------------------------------------------------------ */
app.use('/api/payments', requireAuth, paymentsRoute);

/* ------------------------------------------------------------------ */
/* 7) Other protected routes                                           */
/* ------------------------------------------------------------------ */
app.use('/api/users', requireAuth, usersRoute);
app.use('/api/cards', requireAuth, cardsRoute);
app.use('/api/notifications', requireAuth, notificationsRoute);
app.use('/api/subscriptions', requireAuth, subscriptionsRoute);

const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: 'Too many requests – please slow down.' },
});
app.use('/api/chat', requireAuth, chatLimiter, aiChatRoute);
app.use('/api/chats', requireAuth, sessionsRoute);

/* ------------------------------------------------------------------ */
/* 8) Health-check                                                    */
/* ------------------------------------------------------------------ */
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ */
/* 9) Global error handler                                            */
/* ------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  // If it's a CORS error, send a 403:
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ------------------------------------------------------------------ */
/* 10) Start server                                                   */
/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀  Server running on http://localhost:${PORT}`)
);
