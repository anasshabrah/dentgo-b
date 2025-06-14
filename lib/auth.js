// lib/auth.js
import jwt from 'jsonwebtoken';
import csrfLib from '@dr.pogodin/csurf';
import { JWT_SECRET } from './config.js';
import { authCookieOpts, clearCookieOpts } from '../middleware/cookieConfig.js';

const ACCESS_EXPIRES_IN  = '15m';
const REFRESH_EXPIRES_IN = '30d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET not set. Aborting.');
}

export function signAccess(user) {
  return jwt.sign(
    { userId: user.id, role: user.role ?? 'USER' },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

export function issueRefresh(user) {
  return jwt.sign(
    { userId: user.id },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
}

export function verifyRefresh(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function setAuthCookies(res, access, refresh) {
  // access token cookie: 15 minutes
  res.cookie('access',  access,  authCookieOpts({ maxAge: 15 * 60 * 1000 }));
  // refresh token cookie: 30 days
  res.cookie('refresh', refresh, authCookieOpts({ maxAge: 30 * 24 * 60 * 60 * 1000 }));
}

export function clearAuthCookies(res) {
  res.clearCookie('access',  clearCookieOpts());
  res.clearCookie('refresh', clearCookieOpts());
}

export const csrf = csrfLib({
  cookie: {
    key: 'csrf',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
    ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN
      ? { domain: process.env.COOKIE_DOMAIN }
      : {}),
  },
});
