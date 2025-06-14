// backend/middleware/cookieConfig.js

// Base cookie options; in prod we scope domain, require secure; in dev we relax.
const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  path: '/',
  ...(process.env.NODE_ENV === 'production'
    ? { domain: process.env.COOKIE_DOMAIN || '.dentgo.io' }
    : {}),
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export function authCookieOpts() {
  return { ...baseCookieOptions };
}

export function clearCookieOpts() {
  return { ...baseCookieOptions };
}
