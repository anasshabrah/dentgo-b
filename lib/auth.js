// lib/auth.js
import csurf from '@dr.pogodin/csurf';
import jwt from 'jsonwebtoken';

// 1) CSRF protection middleware
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none'
  }
});
export function csrf(req, res, next) {
  return csrfProtection(req, res, next);
}

// 2) Sign a short-lived access token
export function signAccess(user) {
  return jwt.sign(
    { userId: user.id },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );
}

// 3) Issue a long-lived refresh token
export async function issueRefresh(user) {
  return jwt.sign(
    { userId: user.id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );
}

// 4) Verify & parse a refresh token
export function verifyRefresh(token) {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
}

// 5) Helpers to set/clear auth cookies
export function setAuthCookies(res, accessToken, refreshToken) {
  // Access token
  res.cookie('access', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 15 * 60 * 1000  // 15 minutes
  });
  // Refresh token
  res.cookie('refresh', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 30 * 24 * 60 * 60 * 1000  // 30 days
  });
}

export function clearAuthCookies(res) {
  res.clearCookie('access',  { httpOnly: true, secure: true, sameSite: 'none' });
  res.clearCookie('refresh', { httpOnly: true, secure: true, sameSite: 'none' });
}
