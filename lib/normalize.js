// utils/normalize.js
export function normalizeEmail(email) {
  return typeof email==='string' ? email.toLowerCase().trim() : email;
}
