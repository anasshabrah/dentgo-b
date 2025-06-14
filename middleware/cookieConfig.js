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

// base options for all auth cookies (no maxAge here)
const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  path: '/',
  ...domainSetting,
};

/**
 * Returns cookie options for setting authentication cookies.
 * You can override maxAge (ms) per cookie.
 */
export function authCookieOpts({ maxAge } = {}) {
  return {
    ...baseCookieOptions,
    ...(typeof maxAge === 'number' ? { maxAge } : {}),
  };
}

/**
 * Returns cookie options for clearing cookies.
 * Express will set the expiration to the past; we just need matching path/domain.
 */
export function clearCookieOpts() {
  return { ...baseCookieOptions };
}
