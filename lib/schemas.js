// lib/schemas.js
import { z } from 'zod';

// ─── Input Schemas ─────────────────────────────────────────────────────────────

export const addCardSchema = z.object({
  paymentMethodId: z.string().min(1),
  nickName: z.string().optional()
});

export const updateCardSchema = z.object({
  nickName: z.string().optional(),
  isActive: z.boolean().optional()
});

export const paymentIntentSchema = z.object({
  amount: z.number(),
  currency: z.string().min(1)
});

// For the Stripe‐based “create subscription” endpoint
export const subscriptionStripeCreateSchema = z.object({
  plan: z.enum(['FREE', 'PLUS']),
  priceId: z.string().optional(),
  paymentMethodId: z.string().optional()
});

// For your internal CRUD (/controllers/subscriptions) routes
export const subscriptionCrudSchema = z.object({
  plan: z.enum(['FREE', 'PLUS']),
  status: z.enum(['ACTIVE', 'CANCELED', 'EXPIRED']),
  beganAt: z.string().refine(s => !isNaN(Date.parse(s)), { message: 'Invalid date' }),
  renewsAt: z.string().nullable().optional(),
  cancelsAt: z.string().nullable().optional()
});

export const subscriptionCancelSchema = z.object({
  subscriptionId: z.string().min(1)
});

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  picture: z.string().url().optional(),
  role: z.enum(['USER', 'ADMIN']).optional()
});

export const updateUserSchema = createUserSchema;

export const chatRequestSchema = z.object({
  prompt: z.string().min(1),
  history: z
    .array(z.object({ role: z.string(), text: z.string() }))
    .optional(),
  sessionId: z.number().optional(),
  title: z.string().optional()
});

export const chatCountSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const chatEndSchema = z.object({
  sessionId: z.number()
});

// ─── Response Payload Schemas ──────────────────────────────────────────────────

export const cardResponseSchema = z.object({
  id: z.number(),
  paymentMethodId: z.string(),
  nickName: z.string().nullable(),
  network: z.string(),
  type: z.enum(['DEBIT', 'CREDIT']),
  last4: z.string(),
  expiryMonth: z.number(),
  expiryYear: z.number(),
  isActive: z.boolean(),
  userId: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const subscriptionResponseSchema = z.object({
  id: z.number(),
  userId: z.number(),
  plan: z.string(),
  status: z.string(),
  beganAt: z.string(),
  renewsAt: z.string().nullable(),
  cancelsAt: z.string().nullable()
});
