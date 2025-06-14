// server.js
import './lib/config.js';
import './lib/passport.js';
import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { v4 as uuid } from 'uuid';

import { corsConfig } from './middleware/corsConfig.js';
import requireAuth from './middleware/requireAuth.js';
import { csrf } from './lib/auth.js';

import authRoute from './controllers/auth.js';
import usersRoute from './controllers/users.js';
import cardsRoute from './controllers/cards.js';
import notificationsRoute from './controllers/notifications.js';
import subscriptionsRoute from './controllers/subscriptions.js';
import chatRoute from './controllers/chat.js';
import sessionsRoute from './controllers/chats.js';
import { paymentsRouter, webhookHandler } from './controllers/payments.js';
import xrayRoute from './controllers/xray.js'; // ← New route added

// ← Swagger setup
import { setupOpenApi } from './lib/openapi.js';

const app = express();
app.set('trust proxy', 1);

// Assign a request ID
app.use((req, res, next) => {
  req.id = uuid();
  next();
});

// Morgan tokens for req id & user id
morgan.token('req_id', (req) => req.id);
morgan.token('user_id', (req) => req.user?.id ?? '-');

// 1) Logging & cookies
app.use(
  morgan(':req_id :user_id :method :url :status :response-time ms'),
  cookieParser()
);

// 2) CORS — must precede any routes that read or set cookies
app.use(corsConfig);

// 3) Stripe webhook (raw body scoped to application/json)
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  webhookHandler
);

// 4) JSON + Passport
app.use(express.json(), passport.initialize());

// 5) Auth routes with CSRF protection
app.use(
  '/api/auth',
  (req, res, next) =>
    req.method === 'GET' && req.path === '/csrf-token'
      ? next()
      : csrf(req, res, next),
  authRoute
);

// 6) Protected APIs
app.use('/api/payments', requireAuth, paymentsRouter);
app.use('/api/users', requireAuth, usersRoute);
app.use('/api/cards', requireAuth, cardsRoute);
app.use('/api/notifications', requireAuth, notificationsRoute);
app.use('/api/subscriptions', requireAuth, subscriptionsRoute);

// 7) Chat + rate limiting
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: 'Too many requests' },
});
app.use('/api/chat', requireAuth, chatLimiter, chatRoute);
app.use('/api/chats', requireAuth, sessionsRoute);

// 8) XRay Upload (protected)
app.use('/api', requireAuth, xrayRoute); // ← Added XRay upload controller

// ─── Swagger UI /docs ─────────────────────────────────────────────────────────
setupOpenApi(app);

// 9) Health check & root
app.get('/api/ping', (_, res) => res.json({ ok: true }));
app.get('/', (_, res) => res.send('🚀 DentGo Backend is live!'));

// 10) Global error handler
app.use((err, req, res, next) => {
  console.error(`ERROR [${req.id}] user=${req.user?.id}`, err);
  if (err.code === 'EBADCSRFTOKEN')
    return res.status(403).json({ error: 'Invalid CSRF token' });
  if (err.message?.startsWith('CORS:'))
    return res.status(403).json({ error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
