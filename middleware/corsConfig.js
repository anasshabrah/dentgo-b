// File: middleware/corsConfig.js
import cors from 'cors';

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_ORIGIN,
  'https://dentgo.io',
  'http://localhost:3000',
];
const VERCEL_REGEX = /^https:\/\/dentgo.*\.vercel\.app$/;

export const corsConfig = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || VERCEL_REGEX.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
});
