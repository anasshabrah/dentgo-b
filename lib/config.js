// lib/config.js
//
// Centralised runtime configuration loader + sanity checks.
// Fails FAST (at process-startup) if any critical secret is missing –
// this prevents the request from hanging for ~7 s while jwt.sign()
// throws deep inside the call-stack.

import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import Stripe from 'stripe';
import OpenAI from 'openai';

dotenv.config();

/* ------------------------------------------------------------------ */
/* 1.  Mandatory secrets & keys                                        */
/* ------------------------------------------------------------------ */
const REQUIRED = [
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
  'FRONTEND_ORIGIN',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `❌  Missing required environment variables: ${missing.join(', ')}`,
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 2.  External SDK / client singletons                                */
/* ------------------------------------------------------------------ */
export const JWT_SECRET = process.env.JWT_SECRET;

export const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ------------------------------------------------------------------ */
/* 3.  Convenience export (optional)                                   */
/* ------------------------------------------------------------------ */
export default {
  JWT_SECRET,
  googleClient,
  stripe,
  openai,
};
