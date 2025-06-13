// backend/middleware/cookieConfig.js

// Base cookie options, with domain only in production so localhost cookies work in dev
const baseCookieOptions = {
  httpOnly: true,
  // In production we require secure; in dev it's false
  secure: process.env.NODE_ENV === 'production',
  // Always allow cross-site cookies so fetch()/DELETE include them
  sameSite: 'none',
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
