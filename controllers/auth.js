// File: C:\Users\hanos\cb\backend\controllers\auth.js
import express from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prismaClient.js';
import { googleClient, stripe } from '../lib/config.js';
import { normalizeEmail } from '../lib/normalize.js';
import {
  signAccess,
  issueRefresh,
  verifyRefresh,
  setAuthCookies,
  clearAuthCookies,
  csrf
} from '../lib/auth.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

router.use(rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many auth attempts' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// CSRF token
router.get('/csrf-token', csrf, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Google OAuth (browser)
router.get('/google',
  passport.authenticate('google', { scope: ['profile','email'] })
);

router.get('/google/callback', csrf, (req, res, next) =>
  passport.authenticate('google', { session: false, failureRedirect: '/LetsYouIn' },
  async (err, user) => {
    if (err) return next(err);
    const access  = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.redirect(process.env.FRONTEND_ORIGIN);
  })(req, res, next)
);

// Google OAuth (token)
router.post('/google', csrf, async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: providerUserId, email: rawEmail, name, picture } = ticket.getPayload();
    const email = normalizeEmail(rawEmail);

    // Upsert user
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, picture },
      create: { name, email, picture },
    });

    // Upsert OAuthAccount, updating if it already exists
    await prisma.oAuthAccount.upsert({
      where: {
        provider_providerUserId: { provider: 'google', providerUserId }
      },
      update: { userId: user.id },
      create: { provider: 'google', providerUserId, userId: user.id },
    });

    const access  = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Apple OAuth (browser)
router.get('/apple', passport.authenticate('apple'));

router.post('/apple/callback', csrf, (req, res, next) =>
  passport.authenticate('apple', { session: false, failureRedirect: '/LetsYouIn' },
  async (err, profileUser) => {
    if (err) return next(err);
    const { providerUserId, email: rawEmail, name } = profileUser;
    const email = normalizeEmail(rawEmail);

    const user = await prisma.user.upsert({
      where: { email },
      update: { name },
      create: { name, email, picture: null },
    });

    await prisma.oAuthAccount.upsert({
      where: { provider_providerUserId: { provider: 'apple', providerUserId } },
      update: { userId: user.id, accessToken: profileUser.accessToken ?? undefined, refreshToken: profileUser.refreshToken ?? undefined, expiresAt: null },
      create: { provider: 'apple', providerUserId, userId: user.id, accessToken: profileUser.accessToken, refreshToken: profileUser.refreshToken, expiresAt: null },
    });

    const access  = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.json({ user });
  })(req, res, next)
);

// Refresh token
router.post('/refresh', csrf, async (req, res) => {
  const token = req.cookies.refresh;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  try {
    const payload = verifyRefresh(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const access     = signAccess(user);
    const newRefresh = await issueRefresh(user);
    setAuthCookies(res, access, newRefresh);
    res.json({ access });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// Logout (idempotent)
router.post('/logout', csrf, (req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

// Delete account
router.delete('/delete', csrf, requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // cancel subscriptions
    const subs = await prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', stripeSubscriptionId: { not: null } },
      select: { stripeSubscriptionId: true },
    });
    await Promise.all(subs.map(s =>
      stripe.subscriptions.cancel(s.stripeSubscriptionId).catch(() => null)
    ));

    // detach and delete customer
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.stripeCustomerId) {
      const { data: methods } = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card' });
      await Promise.all(methods.map(pm => stripe.paymentMethods.detach(pm.id)));
      await stripe.customers.del(user.stripeCustomerId);
    }

    const sessions = await prisma.chatSession.findMany({ where: { userId }, select: { id: true } });
    const chatIds = sessions.map(s => s.id);

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { chatId: { in: chatIds } } }),
      prisma.chatSession.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.card.deleteMany({ where: { userId } }),
      prisma.oAuthAccount.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    clearAuthCookies(res);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
