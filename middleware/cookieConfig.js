// middleware/cookieConfig.js

const domainSetting =
  process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN
    ? { domain: process.env.COOKIE_DOMAIN }
    : {};

if (process.env.NODE_ENV === 'production' && !process.env.COOKIE_DOMAIN) {
  console.warn(
    '[cookieConfig] WARNING: COOKIE_DOMAIN is not set in production. Cross-subdomain auth may break.'
  );
}

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  ...domainSetting,
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
