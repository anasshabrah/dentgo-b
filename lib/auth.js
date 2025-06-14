// lib/auth.js
//
// JWT helpers + CSRF middleware.
//
import jwt from 'jsonwebtoken';
import csrfLib from '@dr.pogodin/csurf';
import { JWT_SECRET } from './config.js';

const ACCESS_EXPIRES_IN  = '15m';
const REFRESH_EXPIRES_IN = '30d';

if (!JWT_SECRET) throw new Error('JWT_SECRET not set. Aborting.');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
export function signAccess(user) {
  return jwt.sign(
    { userId: user.id, role: user.role ?? 'USER' },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

export async function issueRefresh(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

export function verifyRefresh(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ──────────────────────────────────────────────────────────────────────────────
// Cookie helpers — now SameSite “none” for cross-site requests
// ──────────────────────────────────────────────────────────────────────────────
const SECURE    = process.env.NODE_ENV === 'production';
const SAME_SITE = 'none';  // always 'none' when using cross-site cookies

function baseCookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: SAME_SITE,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function setAuthCookies(res, access, refresh) {
  // 15 minutes
  res.cookie('access', access, baseCookieOpts(15 * 60 * 1000));
  // 30 days
  res.cookie('refresh', refresh, baseCookieOpts(30 * 24 * 60 * 60 * 1000));
}

export function clearAuthCookies(res) {
  // Clear with identical opts so the browser will remove them
  res.clearCookie('access', baseCookieOpts(0));
  res.clearCookie('refresh', baseCookieOpts(0));
}

// ──────────────────────────────────────────────────────────────────────────────
// CSRF middleware — same policy
// ──────────────────────────────────────────────────────────────────────────────
export const csrf = csrfLib({
  cookie: {
    key: 'csrf',
    httpOnly: true,
    secure: SECURE,
    sameSite: SAME_SITE,
    path: '/',
  },
});
