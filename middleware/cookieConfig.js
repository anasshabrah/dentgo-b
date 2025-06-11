// middleware/cookieConfig.js

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  path: '/',
  domain: process.env.COOKIE_DOMAIN || '.dentgo.io',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

export function authCookieOpts() {
  return { ...baseCookieOptions };
}

export function clearCookieOpts() {
  return { ...baseCookieOptions };
}
