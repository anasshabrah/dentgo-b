// controllers/auth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuid } from 'uuid';
import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';
import { authCookieOpts, clearCookieOpts } from '../middleware/cookieConfig.js';

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const ACCESS_TTL = +process.env.ACCESS_TOKEN_TTL_MIN * 60;
const REFRESH_TTL = +process.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

// ───────── JWT Helpers ─────────
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

// ───────── Cookie Helpers ─────────
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

// ───────── Google OAuth via Passport ─────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/LetsYouIn' }),
  async (req, res) => {
    const user = req.user;
    const access = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.redirect(process.env.FRONTEND_ORIGIN);
  }
);

// ───────── Google One-Tap ─────────
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: providerUserId, email, name, picture } = ticket.getPayload();

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

// ───────── Apple OAuth Callback ─────────
router.get('/apple', passport.authenticate('apple'));

router.post(
  '/apple/callback',
  passport.authenticate('apple', { session: false, failureRedirect: '/LetsYouIn' }),
  async (req, res) => {
    try {
      const { providerUserId, email, name } = req.user;
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
    } catch (err) {
      console.error('Apple OAuth error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
);

// ───────── Refresh Token ─────────
router.post('/refresh', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: 'No refresh token provided' });

  const records = await prisma.refreshToken.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { user: true },
  });

  let match = null;
  for (const r of records) {
    if (await bcrypt.compare(token, r.tokenHash)) {
      match = r;
      break;
    }
  }

  if (!match) return res.status(401).json({ error: 'Invalid refresh token' });

  await prisma.refreshToken.delete({ where: { id: match.id } });
  const newRaw = await issueRefresh(match.user);
  const newAccess = signAccess(match.user);
  setAuthCookies(res, newAccess, newRaw);
  res.json({ user: match.user });
});

// ───────── Logout ─────────
// Removed requireAuth so logout never 401s; always clear cookies.
// If a valid user is present, also delete their refresh tokens.
router.post('/logout', async (req, res) => {
  try {
    if (req.user?.id) {
      await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });
    }
  } catch (err) {
    console.error('Logout cleanup error:', err);
    // swallow any errors here so logout always succeeds
  }
  clearAuthCookies(res);
  res.status(204).end();
});

// ───────── Delete Account ─────────
router.delete('/delete', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    console.log(`Deleting account for user ID: ${userId}`);
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      select: { id: true },
    });
    const chatIds = sessions.map((s) => s.id);

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { chatId: { in: chatIds } } }),
      prisma.chatSession.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.card.deleteMany({ where: { userId } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.subscription.deleteMany({ where: { userId } }),
      prisma.oAuthAccount.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } })
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
