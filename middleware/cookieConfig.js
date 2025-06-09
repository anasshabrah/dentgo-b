// middleware/cookieConfig.js
export function authCookieOpts() {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  };

  if (process.env.NODE_ENV === 'production') {
    // Allow overriding via env for staging/domain flexibility
    if (process.env.COOKIE_DOMAIN) {
      base.domain = process.env.COOKIE_DOMAIN;
    } else {
      base.domain = '.dentgo.io';
    }
  }

  return base;
}

export function clearCookieOpts() {
  const opts = {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  };

  if (process.env.NODE_ENV === 'production') {
    if (process.env.COOKIE_DOMAIN) {
      opts.domain = process.env.COOKIE_DOMAIN;
    } else {
      opts.domain = '.dentgo.io';
    }
  }

  return opts;
}
