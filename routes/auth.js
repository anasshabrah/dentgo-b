// routes/auth.js
require('dotenv').config({ override: true });

const express        = require('express');
const router         = express.Router();
const prisma         = require('../src/lib/prismaClient');
const jwt            = require('jsonwebtoken');
const passport       = require('passport');
const AppleStrategy  = require('passport-apple');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuid }   = require('uuid');
const bcrypt         = require('bcrypt');
const requireAuth    = require('../middleware/requireAuth');

const ACCESS_TTL  = +process.env.ACCESS_TOKEN_TTL_MIN  * 60;
const REFRESH_TTL = +process.env.REFRESH_TOKEN_TTL_DAYS * 24*60*60;

const googleClient = new OAuth2Client(process.env.REACT_APP_GOOGLE_CLIENT_ID);

/* ────────────────────────────────────────────────────────────────── */
/* Helper: sign & issue                                              */
/* ────────────────────────────────────────────────────────────────── */
function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

async function issueRefresh(user) {
  const raw  = uuid();
  const hash = await bcrypt.hash(raw, 10);
  await prisma.refreshToken.create({
    data: {
      tokenHash : hash,
      userId    : user.id,
      expiresAt : new Date(Date.now() + REFRESH_TTL * 1000),
    },
  });
  return raw;
}

function setAuthCookies(res, access, refresh) {
  res.cookie('accessToken', access, {
    httpOnly : true,
    secure   : true,
    sameSite : 'lax',
    maxAge   : ACCESS_TTL * 1000,
  });
  res.cookie('refreshToken', refresh, {
    httpOnly : true,
    secure   : true,
    sameSite : 'lax',
    maxAge   : REFRESH_TTL * 1000,
    path     : '/api/auth/refresh',
  });
}

/* ────────────────────────────────────────────────────────────────── */
/* Google OAuth login                                                */
/* ────────────────────────────────────────────────────────────────── */
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Missing credential' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken  : credential,
      audience : process.env.REACT_APP_GOOGLE_CLIENT_ID,
    });

    const { sub: providerUserId, name, email, picture } = ticket.getPayload();

    const user = await prisma.user.upsert({
      where  : { email },
      update : { name, picture },
      create : { name, email, picture },
    });

    await prisma.oAuthAccount.upsert({
      where  : { provider_providerUserId: { provider: 'google', providerUserId } },
      update : {},
      create : { provider: 'google', providerUserId, userId: user.id },
    });

    const access  = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.json({ user });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

/* ────────────────────────────────────────────────────────────────── */
/* Apple OAuth (Passport)                                            */
/* ────────────────────────────────────────────────────────────────── */
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj,  done) => done(null, obj));

passport.use(
  new AppleStrategy(
    {
      clientID           : process.env.APPLE_CLIENT_ID,
      teamID             : process.env.APPLE_TEAM_ID,
      keyID              : process.env.APPLE_KEY_ID,
      privateKeyLocation : process.env.APPLE_PRIVATE_KEY_PATH,
      callbackURL        : `${process.env.FRONTEND_ORIGIN}/api/auth/apple/callback`,
      scope: ['name', 'email'],
    },
    (accessToken, refreshToken, idToken, profile, done) => {
      done(null, {
        providerUserId : profile.id,
        email          : profile.email,
        name           : `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim(),
      });
    },
  )
);

router.get('/apple', passport.authenticate('apple'));

router.post(
  '/apple/callback',
  passport.authenticate('apple', { session: false, failureRedirect: '/LetsYouIn' }),
  async (req, res) => {
    try {
      const { providerUserId, email, name } = req.user;

      const user = await prisma.user.upsert({
        where  : { email },
        update : { name },
        create : { name, email, picture: null },
      });

      await prisma.oAuthAccount.upsert({
        where  : { provider_providerUserId: { provider: 'apple', providerUserId } },
        update : {},
        create : { provider: 'apple', providerUserId, userId: user.id },
      });

      const access  = signAccess(user);
      const refresh = await issueRefresh(user);
      setAuthCookies(res, access, refresh);
      res.json({ user });
    } catch (err) {
      console.error('Apple login error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
);

/* ────────────────────────────────────────────────────────────────── */
/* Refresh access token (rotate refresh)                             */
/* ────────────────────────────────────────────────────────────────── */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  // scan for matching hash
  const tokens = await prisma.refreshToken.findMany({
    where   : { expiresAt: { gt: new Date() } },
    include : { user: true },
  });

  let stored = null;
  for (const t of tokens) {
    /* eslint-disable no-await-in-loop */
    if (await bcrypt.compare(refreshToken, t.tokenHash)) { stored = t; break; }
  }
  if (!stored) return res.status(401).json({ error: 'Invalid refresh token' });

  // rotate
  await prisma.refreshToken.delete({ where: { id: stored.id } });
  const newRefresh = await issueRefresh(stored.user);
  const newAccess  = signAccess(stored.user);
  setAuthCookies(res, newAccess, newRefresh);
  res.json({ user: stored.user });
});

/* ────────────────────────────────────────────────────────────────── */
/* Logout (always succeeds, even if JWT is already expired)          */
/* ────────────────────────────────────────────────────────────────── */
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.cookies;
  if (refreshToken) {
    const tokens = await prisma.refreshToken.findMany();
    await Promise.all(tokens.map(t =>
      bcrypt.compare(refreshToken, t.tokenHash)
        .then(match => match ? prisma.refreshToken.delete({ where: { id: t.id } }) : null)
    ));
  }
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.status(204).end();
});

module.exports = router;
