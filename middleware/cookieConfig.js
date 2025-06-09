// middleware/cookieConfig.js

/**
 * This function returns the options for setting auth cookies
 * with secure, httpOnly, and SameSite attributes configured correctly.
 */
export function authCookieOpts() {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  };

  if (process.env.NODE_ENV === 'production') {
    base.domain = process.env.COOKIE_DOMAIN || '.dentgo.io';
  }

  return base;
}

/**
 * This function returns the options for clearing auth cookies.
 * It must match the domain/path/secure/sameSite used to set the cookies.
 */
export function clearCookieOpts() {
  const opts = {
    httpOnly: true,  // matches authCookieOpts
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  };

  if (process.env.NODE_ENV === 'production') {
    opts.domain = process.env.COOKIE_DOMAIN || '.dentgo.io';
  }

  return opts;
}
