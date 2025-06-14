// middleware/corsConfig.js
import cors from 'cors';

const ORIGINS = [
  process.env.FRONTEND_ORIGIN,
  'https://dentgo.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://api.dentgo.io'
];

const VERCEL = /^https:\/\/dentgo.*\.vercel\.app$/;

export const corsConfig = cors({
  origin: (origin, cb) => {
    if (!origin || ORIGINS.includes(origin) || VERCEL.test(origin)) {
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
