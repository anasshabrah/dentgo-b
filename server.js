// backend/server.js
import 'dotenv/config';
import './lib/passport.js';
import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import csurf from '@dr.pogodin/csurf';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

import { corsConfig } from './middleware/corsConfig.js';
import requireAuth from './middleware/requireAuth.js';

// sanity‐check critical env
[
  'FRONTEND_ORIGIN',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_ID',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ACCESS_TOKEN_TTL_MIN',
  'REFRESH_TOKEN_TTL_DAYS',
  'OPENAI_API_KEY'
].forEach((k) => {
  if (!process.env[k]) {
    console.error(`❌ Missing env var ${k}`);
    process.exit(1);
  }
});

import authRoute from './controllers/auth.js';
import usersRoute from './controllers/users.js';
import cardsRoute from './controllers/cards.js';
import notificationsRoute from './controllers/notifications.js';
import subscriptionsRoute from './controllers/subscriptions.js';
import aiChatRoute from './controllers/chat.js';
import sessionsRoute from './controllers/chats.js';
import { webhookHandler, paymentsRouter } from './controllers/payments.js';

const app = express();
app.set('trust proxy', 1);

// 1) Logging
app.use(morgan('dev'));

// 2) Cookies before CORS!
app.use(cookieParser());

// 3) CORS (with credentials)
app.use(corsConfig);

// 4) Stripe Webhook (raw) BEFORE express.json()
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  webhookHandler
);

// 5) JSON body for everything else
app.use(express.json());

// 6) Passport init
app.use(passport.initialize());

// 7) CSRF protection for auth routes (using double-submit cookie with strict SameSite)
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  }
});

// 8) Public auth, now with CSRF
app.use('/api/auth', csrfProtection, authRoute);

// 9) Protected payments
app.use('/api/payments', requireAuth, paymentsRouter);

// 10) Other protected
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

// 11) Health-check
app.get('/api/ping', (_q, r) => r.json({ ok: true }));
app.get('/', (_q, r) => r.send('🚀 DentGo Backend is live!'));

// 12) Global error handler
app.use((err, _req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.code === 'EBADCSRFTOKEN') {
    // CSRF token errors
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  return next(err);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
