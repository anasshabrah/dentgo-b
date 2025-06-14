// utils/auth.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuid } from 'uuid';
import prisma from '../lib/prismaClient.js';
import { jwtSecret, accessTTL, refreshTTL, csrfMiddleware } from '../lib/config.js';
import { authCookieOpts, clearCookieOpts } from '../middleware/cookieConfig.js';

export function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: accessTTL }
  );
}

export async function issueRefresh(user) {
  const raw = uuid();
  const hash = await bcrypt.hash(raw, 10);
  await prisma.refreshToken.create({
    data: { tokenHash: hash, userId: user.id, expiresAt: new Date(Date.now() + refreshTTL*1000) }
  });
  return raw;
}

export function setAuthCookies(res, access, refresh) {
  const opts = authCookieOpts();
  res.cookie('accessToken', access, { ...opts, maxAge: accessTTL*1000 });
  res.cookie('refreshToken', refresh, { ...opts, maxAge: refreshTTL*1000 });
}

export function clearAuthCookies(res) {
  const opts = clearCookieOpts();
  res.clearCookie('accessToken', opts);
  res.clearCookie('refreshToken', opts);
}

export const csrf = csrfMiddleware;
