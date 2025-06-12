// backend/middleware/corsConfig.js
import cors from 'cors';

// Load your expected front-end origin from env (e.g. VITE_SERVER_URL’s host)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://dentgo.io';

const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  'https://dentgo.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://api.dentgo.io'
];

// Allow any subdomain of vercel.app that starts with "dentgo"
const VERCEL_REGEX = /^https:\/\/dentgo.*\.vercel\.app$/;

export const corsConfig = cors({
  origin: (origin, callback) => {
    // non-browser requests (Postman, curl) have no origin header
    if (!origin) {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.includes(origin) || VERCEL_REGEX.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
  // Ensure DELETE (and the preflight OPTIONS) are allowed
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
  maxAge: 86400, // cache preflight for 24 hours
});
