// controllers/auth.js
import express from 'express';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';

import prisma from '../lib/prismaClient.js';
import { googleClient, stripe } from '../lib/config.js';
import { normalizeEmail } from '../lib/normalize.js';
import { signAccess, issueRefresh, setAuthCookies, clearAuthCookies, csrf } from '../lib/auth.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many auth attempts' },
  standardHeaders: true,
  legacyHeaders: false
});
router.use(authLimiter);

// 1) CSRF token endpoint
router.get('/csrf-token', csrf, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// 2) Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get(
  '/google/callback',
  csrf,
  (req, res, next) =>
    passport.authenticate('google', { session: false, failureRedirect: '/LetsYouIn' }, async (err, user) => {
      if (err) return next(err);
      const access = signAccess(user);
      const refresh = await issueRefresh(user);
      setAuthCookies(res, access, refresh);
      res.redirect(process.env.FRONTEND_ORIGIN);
    })(req, res, next)
);

router.post('/google', csrf, async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
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
    console.error(err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// 3) Apple OAuth
router.get('/apple', passport.authenticate('apple'));
router.post(
  '/apple/callback',
  csrf,
  (req, res, next) =>
    passport.authenticate('apple', { session: false, failureRedirect: '/LetsYouIn' }, async (err, profileUser) => {
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
        update: {},
        create: { provider: 'apple', providerUserId, userId: user.id },
      });

      const access = signAccess(user);
      const refresh = await issueRefresh(user);
      setAuthCookies(res, access, refresh);
      res.json({ user });
    })(req, res, next)
);

// 4) Refresh tokens (fixed bcrypt.compare usage)
router.post('/refresh', csrf, async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  const records = await prisma.refreshToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: true }
  });
  const match = (
    await Promise.all(records.map(async r =>
      (await bcrypt.compare(token, r.tokenHash)) ? r : null
    ))
  ).find(Boolean);

  if (!match) return res.status(401).json({ error: 'Invalid refresh token' });

  await prisma.refreshToken.delete({ where: { id: match.id } });
  const user = match.user;
  const newRaw = await issueRefresh(user);
  const newAccess = signAccess(user);
  setAuthCookies(res, newAccess, newRaw);
  res.json({ user });
});

// 5) Logout
router.post('/logout', csrf, requireAuth, async (req, res) => {
  await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
  clearAuthCookies(res);
  res.status(204).end();
});

// 6) Delete account (unchanged)
router.delete('/delete', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const subs = await prisma.subscription.findMany({
      where: {
        userId: uid,
        status: 'ACTIVE',
        stripeSubscriptionId: { not: null }
      },
      select: { stripeSubscriptionId: true }
    });
    await Promise.all(subs.map(s =>
      stripe.subscriptions.del(s.stripeSubscriptionId).catch(() => null)
    ));

    const u = await prisma.user.findUnique({ where: { id: uid } });
    if (u.stripeCustomerId) {
      const { data: methods } = await stripe.paymentMethods.list({
        customer: u.stripeCustomerId,
        type: 'card'
      });
      await Promise.all(methods.map(pm => stripe.paymentMethods.detach(pm.id)));
      await stripe.customers.del(u.stripeCustomerId);
    }

    const sessions = await prisma.chatSession.findMany({
      where: { userId: uid },
      select: { id: true }
    });
    const chatIds = sessions.map(s => s.id);
    await prisma.$transaction([
      prisma.message.deleteMany({ where: { chatId: { in: chatIds } } }),
      prisma.chatSession.deleteMany({ where: { userId: uid } }),
      prisma.refreshToken.deleteMany({ where: { userId: uid } }),
      prisma.card.deleteMany({ where: { userId: uid } }),
      prisma.notification.deleteMany({ where: { userId: uid } }),
      prisma.subscription.deleteMany({ where: { userId: uid } }),
      prisma.oAuthAccount.deleteMany({ where: { userId: uid } }),
      prisma.user.delete({ where: { id: uid } })
    ]);

    clearAuthCookies(res);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
