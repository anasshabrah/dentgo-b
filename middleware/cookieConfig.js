// middleware/cookieConfig.js

/**
 * This function returns the options for setting auth cookies
 * with secure, httpOnly, and SameSite attributes configured correctly.
 * NOTE: domain is intentionally omitted to ensure cookies work cross-origin.
 */
export function authCookieOpts() {
  const base = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
    // domain is intentionally omitted when no shared domain exists
  };

  return base;
}

/**
 * This function returns the options for clearing auth cookies.
 * It must match the domain/path/secure/sameSite used to set the cookies.
 */
export function clearCookieOpts() {
  const opts = {
    httpOnly: true, // matches authCookieOpts
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
    // domain is intentionally omitted when no shared domain exists
  };

  return opts;
}
