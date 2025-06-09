// middleware/cookieConfig.js

export function authCookieOpts() {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
    domain: process.env.COOKIE_DOMAIN || '.dentgo.io',
  };
  return base;
}

export function clearCookieOpts() {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
    domain: process.env.COOKIE_DOMAIN || '.dentgo.io',
  };
  return opts;
}
