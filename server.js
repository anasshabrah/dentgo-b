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
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;

/* ------------------------------------------------------------------ */
/* 1) Generic middleware                                              */
/* ------------------------------------------------------------------ */
app.use(morgan('dev'));

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
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
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ------------------------------------------------------------------ */
/* 10) Start server                                                   */
/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`🚀  Server running on http://localhost:${PORT}`)
);
