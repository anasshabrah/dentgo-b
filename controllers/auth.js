// backend/controllers/auth.js

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuid } from 'uuid';
import Stripe from 'stripe';
import csurf from '@dr.pogodin/csurf';

import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';
import { authCookieOpts, clearCookieOpts } from '../middleware/cookieConfig.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-05-28.basil',
});

const ACCESS_TTL = +process.env.ACCESS_TOKEN_TTL_MIN * 60;
const REFRESH_TTL = +process.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts – please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(authLimiter);

function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : email;
}

function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

async function issueRefresh(user) {
  const raw = uuid();
  const hash = await bcrypt.hash(raw, 10);
  await prisma.refreshToken.create({
    data: {
      tokenHash: hash,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
    },
  });
  return raw;
}

function setAuthCookies(res, access, refresh) {
  const opts = authCookieOpts();
  res.cookie('accessToken', access, { ...opts, maxAge: ACCESS_TTL * 1000 });
  res.cookie('refreshToken', refresh, { ...opts, maxAge: REFRESH_TTL * 1000 });
}

function clearAuthCookies(res) {
  const opts = clearCookieOpts();
  res.clearCookie('accessToken', opts);
  res.clearCookie('refreshToken', opts);
}

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  }
});

// 1) Expose CSRF token for client to fetch
router.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// 2) Google OAuth handlers
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get(
  '/google/callback',
  csrfProtection,
  (req, res, next) => {
    passport.authenticate(
      'google',
      { session: false, failureRedirect: '/LetsYouIn' },
      async (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect('/LetsYouIn');
        try {
          const access = signAccess(user);
          const refresh = await issueRefresh(user);
          setAuthCookies(res, access, refresh);
          res.redirect(process.env.FRONTEND_ORIGIN);
        } catch (e) {
          next(e);
        }
      }
    )(req, res, next);
  }
);

router.post('/google', csrfProtection, async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: providerUserId, email: rawEmail, name, picture } = ticket.getPayload();
    const email = normalizeEmail(rawEmail);

    const user = await prisma.user.upsert({
      where: { email },
      update: { name, picture },
      create: { name, email, picture },
    });
    await prisma.oAuthAccount.upsert({
      where: { provider_providerUserId: { provider: 'google', providerUserId } },
      update: {},
      create: { provider: 'google', providerUserId, userId: user.id },
    });

    const access = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.json({ user });
  } catch (err) {
    console.error('Google One-Tap error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// 3) Apple OAuth handlers
router.get('/apple', passport.authenticate('apple'));
router.post(
  '/apple/callback',
  csrfProtection,
  (req, res, next) => {
    passport.authenticate(
      'apple',
      { session: false, failureRedirect: '/LetsYouIn' },
      async (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect('/LetsYouIn');
        try {
          const { providerUserId, email: rawEmail, name } = user;
          const email = normalizeEmail(rawEmail);
          const upserted = await prisma.user.upsert({
            where: { email },
            update: { name },
            create: { name, email, picture: null },
          });
          await prisma.oAuthAccount.upsert({
            where: { provider_providerUserId: { provider: 'apple', providerUserId } },
            update: {},
            create: { provider: 'apple', providerUserId, userId: upserted.id },
          });

          const access = signAccess(upserted);
          const refresh = await issueRefresh(upserted);
          setAuthCookies(res, access, refresh);
          res.json({ user: upserted });
        } catch (e) {
          next(e);
        }
      }
    )(req, res, next);
  }
);

// 4) Refresh endpoint now protected by CSRF + logging/invalidation
router.post('/refresh', csrfProtection, async (req, res) => {
  const token = req.cookies.refreshToken;
  console.log('🔄 /refresh invoked, token from cookie:', token);

  if (!token) {
    console.warn('↩️  No refresh token provided');
    return res.status(401).json({ error: 'No refresh token provided' });
  }

  const records = await prisma.refreshToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  console.log(`📚 Found ${records.length} non-expired refresh records`);

  let match = null;
  for (const r of records) {
    if (await bcrypt.compare(token, r.tokenHash)) {
      match = r;
      break;
    }
  }

  if (!match) {
    console.warn('❌ No matching refresh token record');
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  console.log(
    `✅ Refresh token matched record ID ${match.id} for user ${match.user.email}`
  );

  // revoke old, issue new
  await prisma.refreshToken.delete({ where: { id: match.id } });
  const newRaw = await issueRefresh(match.user);
  const newAccess = signAccess(match.user);
  setAuthCookies(res, newAccess, newRaw);

  res.json({ user: match.user });
});

// 5) Logout
router.post('/logout', csrfProtection, async (req, res) => {
  try {
    if (req.user?.id) {
      await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    }
  } catch (err) {
    console.error('Logout cleanup error:', err);
  }
  clearAuthCookies(res);
  res.status(204).end();
});

// 6) Delete account
router.delete('/delete', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    console.log(`Deleting account for user ID: ${userId}`);

    // cancel subscriptions, detach payment methods, delete customer...
    const activeSubs = await prisma.subscription.findMany({
      where: { userId, stripeSubscriptionId: { not: null }, status: 'ACTIVE' },
      select: { stripeSubscriptionId: true },
    });
    await Promise.all(
      activeSubs.map(async ({ stripeSubscriptionId }) => {
        try {
          await stripe.subscriptions.del(stripeSubscriptionId);
        } catch (err) {
          console.warn(`⚠️ Could not delete Stripe subscription ${stripeSubscriptionId}:`, err.message || err);
        }
      })
    );

    const userRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (userRecord?.stripeCustomerId) {
      const { data: methods } = await stripe.paymentMethods.list({
        customer: userRecord.stripeCustomerId,
        type: 'card',
      });
      await Promise.all(methods.map(pm => stripe.paymentMethods.detach(pm.id)));
      await stripe.customers.del(userRecord.stripeCustomerId);
      console.log(`Deleted Stripe customer ${userRecord.stripeCustomerId}`);
    }

    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      select: { id: true },
    });
    const chatIds = sessions.map(s => s.id);

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { chatId: { in: chatIds } } }),
      prisma.chatSession.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.card.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.oAuthAccount.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    clearAuthCookies(res);
    console.log(`✅ Successfully deleted account for user ID: ${userId}`);
    res.status(204).end();
  } catch (err) {
    console.error('❌ Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
