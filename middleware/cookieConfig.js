// middleware/cookieConfig.js

// Base cookie options, with domain only in production so localhost cookies work in dev
const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // In production, we need SameSite='none' for cross-site cookies; in dev, lax is fine
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  // Only set domain in production (scope to your public domain)
  ...(process.env.NODE_ENV === 'production'
    ? { domain: process.env.COOKIE_DOMAIN || '.dentgo.io' }
    : {}),
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

export function authCookieOpts() {
  return { ...baseCookieOptions };
}

export function clearCookieOpts() {
  return { ...baseCookieOptions };
}