// lib/auth.js
//
// JWT helpers + CSRF middleware.
// Adds explicit secret checks so authentication failures return *instantly*
// with a 500, rather than hanging the request chain.

import jwt from 'jsonwebtoken';
import csrfLib from '@dr.pogodin/csurf';
import { JWT_SECRET } from './config.js';

const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '30d';

/* ------------------------------------------------------------------ */
/* 1.  Guard – JWT secret MUST exist (config.js already verifies)      */
/* ------------------------------------------------------------------ */
if (!JWT_SECRET) {
  // Extra belt-&-braces – this should never fire because config.js exits first.
  throw new Error('JWT_SECRET not set. Aborting.');
}

/* ------------------------------------------------------------------ */
/* 2.  JWT helpers                                                     */
/* ------------------------------------------------------------------ */
export function signAccess(user) {
  return jwt.sign(
    { userId: user.id, role: user.role ?? 'USER' },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN },
  );
}

export async function issueRefresh(user) {
  // Simple refresh – if you track tokenVersion add it here.
  return jwt.sign(
    { userId: user.id },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN },
  );
}

export function verifyRefresh(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function setAuthCookies(res, access, refresh) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('access', access, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh', refresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res) {
  res.clearCookie('access');
  res.clearCookie('refresh');
}

/* ------------------------------------------------------------------ */
/* 3.  CSRF helper (re-export)                                         */
/* ------------------------------------------------------------------ */
export const csrf = csrfLib({
  cookie: {
    key: 'csrf',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
});
