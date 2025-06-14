// lib/config.js
import 'dotenv/config';
import Stripe from 'stripe';
import { OpenAI } from 'openai';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import csurf from '@dr.pogodin/csurf';

// ensure required envs
[
  'FRONTEND_ORIGIN','JWT_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY',
  'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ACCESS_TOKEN_TTL_MIN',
  'REFRESH_TOKEN_TTL_DAYS','OPENAI_API_KEY'
].forEach(k => {
  if (!process.env[k]) {
    console.error(`❌ Missing env ${k}`); process.exit(1);
  }
});

export const jwtSecret = process.env.JWT_SECRET;
export const accessTTL  = +process.env.ACCESS_TOKEN_TTL_MIN * 60;
export const refreshTTL = +process.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: process.env.STRIPE_API_VERSION,
});
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const csrfMiddleware = csurf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV==='production',
    sameSite: 'strict',
  }
});
