// backend/middleware/cookieConfig.js

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN
    ? { domain: process.env.COOKIE_DOMAIN }
    : {}),
};

/**
 * Returns cookie options for setting authentication cookies.
 * Use with res.cookie('access', token, authCookieOpts())
 */
export function authCookieOpts() {
  return { ...baseCookieOptions };
}

/**
 * Returns cookie options for clearing cookies.
 * Use with res.clearCookie('access', clearCookieOpts())
 */
export function clearCookieOpts() {
  return { ...baseCookieOptions };
}
