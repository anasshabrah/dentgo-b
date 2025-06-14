// lib/auth.js
import jwt from 'jsonwebtoken';
import csrfLib from '@dr.pogodin/csurf';
import { JWT_SECRET } from './config.js';

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

const SECURE      = process.env.NODE_ENV === 'production';
const SAME_SITE   = 'none';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN; // e.g. “.dentgo.io”

function baseCookieOpts(maxAgeMs) {
  const opts = {
    httpOnly: true,
    secure: SECURE,
    sameSite: SAME_SITE,
    path: '/',
    maxAge: maxAgeMs,
  };
  if (SECURE && COOKIE_DOMAIN) {
    opts.domain = COOKIE_DOMAIN;
  }
  return opts;
}

export function setAuthCookies(res, access, refresh) {
  res.cookie('access',  access,  baseCookieOpts(15  * 60 * 1000));          // 15m
  res.cookie('refresh', refresh, baseCookieOpts(30 * 24 * 60 * 60 * 1000)); // 30d
}

export function clearAuthCookies(res) {
  // must match the same domain/path settings so the browser actually clears them
  res.clearCookie('access',  baseCookieOpts(0));
  res.clearCookie('refresh', baseCookieOpts(0));
}

export const csrf = csrfLib({
  cookie: {
    key: 'csrf',
    httpOnly: true,
    secure: SECURE,
    sameSite: SAME_SITE,
    path: '/',
    ...(SECURE && COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  },
});
