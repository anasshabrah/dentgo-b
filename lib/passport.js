// lib/passport.js
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as AppleStrategy } from 'passport-apple';
import prisma from './prismaClient.js';

// helper to normalize emails everywhere
function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : email;
}

// Persist user object to session (required for AppleStrategy)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Google OAuth strategy (unchanged)...
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/auth/google/callback',
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const rawEmail = profile.emails?.[0]?.value;
        const email = normalizeEmail(rawEmail);
        const name = profile.displayName;
        const pic = profile.photos?.[0]?.value;
        const providerUserId = profile.id;

        const user = await prisma.user.upsert({
          where: { email },
          update: { name, picture: pic },
          create: { name, email, picture: pic },
        });

        await prisma.oAuthAccount.upsert({
          where: {
            provider_providerUserId: { provider: 'google', providerUserId },
          },
          update: {},
          create: { provider: 'google', providerUserId, userId: user.id },
        });

        done(null, user);
      } catch (err) {
        console.error('GoogleStrategy error:', err);
        done(err, null);
      }
    }
  )
);

// Apple OAuth strategy with token persistence
passport.use(
  new AppleStrategy(
    {
      clientID: process.env.APPLE_CLIENT_ID,
      teamID: process.env.APPLE_TEAM_ID,
      keyID: process.env.APPLE_KEY_ID,
      privateKey: process.env.APPLE_PRIVATE_KEY,
      callbackURL: process.env.APPLE_CALLBACK_URL,
      scope: ['name', 'email'],
    },
    async (accessToken, refreshToken, idToken, profile, done) => {
      try {
        const rawEmail = profile.email;
        const email = normalizeEmail(rawEmail);
        const name = `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim();
        const providerUserId = profile.id;

        const user = await prisma.user.upsert({
          where: { email },
          update: { name },
          create: { name, email, picture: null },
        });

        await prisma.oAuthAccount.upsert({
          where: {
            provider_providerUserId: { provider: 'apple', providerUserId },
          },
          update: {
            accessToken,
            refreshToken: refreshToken ?? undefined,
            expiresAt: null
          },
          create: {
            provider: 'apple',
            providerUserId,
            userId: user.id,
            accessToken,
            refreshToken: refreshToken ?? null,
            expiresAt: null
          }
        });

        done(null, user);
      } catch (err) {
        console.error('AppleStrategy error:', err);
        done(err, null);
      }
    }
  )
);

// No export needed; importing this file registers strategies on the global `passport` instance.
