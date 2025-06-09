// backend/controllers/auth.js
require("dotenv").config({ override: true });

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prismaClient");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const AppleStrategy = require("passport-apple");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { OAuth2Client } = require("google-auth-library");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcrypt");
const requireAuth = require("../middleware/requireAuth");

const ACCESS_TTL = +process.env.ACCESS_TOKEN_TTL_MIN * 60;
const REFRESH_TTL = +process.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ─────────────── JWT Helpers ─────────────── */
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
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  };
  res.cookie("accessToken", access, { ...opts, maxAge: ACCESS_TTL * 1000 });
  res.cookie("refreshToken", refresh, { ...opts, maxAge: REFRESH_TTL * 1000 });
}

/* ─────────── Google OAuth (Traditional) ─────────── */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
    },
    async (_, __, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const pic = profile.photos?.[0]?.value;
        const providerUserId = profile.id;

        const user = await prisma.user.upsert({
          where: { email },
          update: { name, picture: pic },
          create: { name, email, picture: pic },
        });

        await prisma.oAuthAccount.upsert({
          where: { provider_providerUserId: { provider: "google", providerUserId } },
          update: {},
          create: { provider: "google", providerUserId, userId: user.id },
        });

        done(null, user);
      } catch (err) {
        console.error("GoogleStrategy error:", err);
        done(err, null);
      }
    }
  )
);

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/LetsYouIn" }),
  async (req, res) => {
    const user = req.user;
    const access = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.redirect(process.env.FRONTEND_ORIGIN || "https://dentgo-f.vercel.app");
  }
);

/* ─────────── Google One-Tap Login ─────────── */
router.post("/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing credential" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { sub: providerUserId, name, email, picture } = ticket.getPayload();
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, picture },
      create: { name, email, picture },
    });

    await prisma.oAuthAccount.upsert({
      where: { provider_providerUserId: { provider: "google", providerUserId } },
      update: {},
      create: { provider: "google", providerUserId, userId: user.id },
    });

    const access = signAccess(user);
    const refresh = await issueRefresh(user);
    setAuthCookies(res, access, refresh);
    res.json({ user });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(401).json({ error: "Authentication failed" });
  }
});

/* ─────────── Apple OAuth ─────────── */
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new AppleStrategy(
    {
      clientID: process.env.APPLE_CLIENT_ID,
      teamID: process.env.APPLE_TEAM_ID,
      keyID: process.env.APPLE_KEY_ID,
      privateKey: process.env.APPLE_PRIVATE_KEY,
      callbackURL: process.env.APPLE_CALLBACK_URL,
      scope: ["name", "email"],
    },
    (_, __, ___, profile, done) => {
      done(null, {
        providerUserId: profile.id,
        email: profile.email,
        name: `${profile.name?.givenName || ""} ${profile.name?.familyName || ""}`.trim(),
      });
    }
  )
);

router.get("/apple", passport.authenticate("apple"));
router.post(
  "/apple/callback",
  passport.authenticate("apple", { session: false, failureRedirect: "/LetsYouIn" }),
  async (req, res) => {
    try {
      const { providerUserId, email, name } = req.user;
      const user = await prisma.user.upsert({
        where: { email },
        update: { name },
        create: { name, email, picture: null },
      });

      await prisma.oAuthAccount.upsert({
        where: { provider_providerUserId: { provider: "apple", providerUserId } },
        update: {},
        create: { provider: "apple", providerUserId, userId: user.id },
      });

      const access = signAccess(user);
      const refresh = await issueRefresh(user);
      setAuthCookies(res, access, refresh);
      res.json({ user });
    } catch (err) {
      console.error("Apple login error:", err);
      res.status(500).json({ error: "Authentication failed" });
    }
  }
);

/* ─────────── Refresh ─────────── */
router.post("/refresh", async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: "No refresh token" });

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
  if (!match) return res.status(401).json({ error: "Invalid refresh token" });

  await prisma.refreshToken.delete({ where: { id: match.id } });
  const newRefresh = await issueRefresh(match.user);
  const newAccess = signAccess(match.user);
  setAuthCookies(res, newAccess, newRefresh);
  res.json({ user: match.user });
});

/* ─────────── Logout ─────────── */
router.post("/logout", requireAuth, async (req, res) => {
  // delete all this user’s refresh tokens
  await prisma.refreshToken.deleteMany({ where: { userId: req.user.id } });

  // clear cookies
  const opts = {
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  };
  res.clearCookie("accessToken", opts);
  res.clearCookie("refreshToken", opts);
  res.status(204).end();
});

/* ─────────── Delete Account ─────────── */
router.delete("/delete", requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    // 1) Remove all refresh tokens for this user
    await prisma.refreshToken.deleteMany({ where: { userId } });

    // 2) Remove dependent records to satisfy foreign key constraints
    await prisma.chatSession.deleteMany({ where: { userId } });
    await prisma.card.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.subscription.deleteMany({ where: { userId } });

    // 3) Delete the user record
    await prisma.user.delete({ where: { id: userId } });

    // 4) Clear auth cookies
    const opts = {
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
    };
    res.clearCookie("accessToken", opts);
    res.clearCookie("refreshToken", opts);

    // 5) Done
    res.status(204).end();
  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

module.exports = router;
