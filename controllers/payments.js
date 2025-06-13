// backend/controllers/payments.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import requireAuth from '../middleware/requireAuth.js';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-05-28.basil',
});

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/payments/create-customer
 */
router.post('/create-customer', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (existing.stripeCustomerId) {
      return res.json({ customerId: existing.stripeCustomerId });
    }

    const customer = await stripe.customers.create({
      email: existing.email,
      name: existing.name,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    res.json({ customerId: customer.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/create-setup-intent
 */
router.post('/create-setup-intent', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (!userRecord) return res.status(404).json({ error: 'User not found' });

    let customerId = userRecord.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userRecord.email,
        name: userRecord.name,
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
    });

    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/create-payment-intent
 */
router.post('/create-payment-intent', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, currency } = req.body;
    if (typeof amount !== 'number' || !currency) {
      return res.status(400).json({ error: 'Missing amount or currency' });
    }

    const userRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (!userRecord) return res.status(404).json({ error: 'User not found' });

    let customerId = userRecord.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userRecord.email,
        name: userRecord.name,
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/create-subscription
 */
router.post('/create-subscription', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { priceId: frontendPriceId, paymentMethodId } = req.body || {};

    // If no priceId provided, assume FREE plan
    const selectedPriceId = frontendPriceId || 'FREE';

    // ─── FREE plan ───
    if (selectedPriceId === 'FREE') {
      // Check if they already have an active FREE sub
      const existing = await prisma.subscription.findFirst({
        where: { userId, plan: 'FREE', status: 'ACTIVE' },
      });
      if (existing) {
        return res.json({
          subscriptionId: existing.stripeSubscriptionId,
          status: existing.status.toLowerCase(),
          currentPeriodEnd: existing.renewsAt
            ? Math.floor(existing.renewsAt.getTime() / 1000)
            : null,
          plan: 'FREE',
        });
      }

      // Create a new FREE subscription record
      const now = new Date();
      const freeSub = await prisma.subscription.create({
        data: {
          userId,
          plan: 'FREE',
          status: 'ACTIVE',
          beganAt: now,
          renewsAt: null,
          stripeSubscriptionId: null,
          stripePriceId: null,
        },
      });

      return res.json({
        subscriptionId: freeSub.stripeSubscriptionId,
        status: 'active',
        currentPeriodEnd: null,
        plan: 'FREE',
      });
    }

    // ─── PLUS plan ───
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Missing paymentMethodId for PLUS plan' });
    }

    const userRecord = await prisma.user.findUnique({ where: { id: userId } });
    if (!userRecord?.stripeCustomerId) {
      return res.status(400).json({ error: 'Stripe customer not found for user' });
    }

    // Attach the payment method and set it as default
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: userRecord.stripeCustomerId,
    });
    await stripe.customers.update(userRecord.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Create the Stripe subscription
    const stripeSub = await stripe.subscriptions.create({
      customer: userRecord.stripeCustomerId,
      items: [{ price: selectedPriceId }],
      expand: ['latest_invoice.payment_intent'],
    });

    // Persist to your DB (map everything non-FREE → PLUS)
    const newSub = await prisma.subscription.create({
      data: {
        userId,
        plan: 'PLUS',  // only remaining paid tier
        status: stripeSub.status.toUpperCase(),
        beganAt: new Date(stripeSub.created * 1000),
        renewsAt: stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000)
          : null,
        stripeSubscriptionId: stripeSub.id,
        stripePriceId: selectedPriceId,
      },
    });

    const intent = stripeSub.latest_invoice.payment_intent;
    res.json({
      subscriptionId: newSub.stripeSubscriptionId,
      clientSecret: intent.client_secret,
      status: stripeSub.status.toLowerCase(),
      currentPeriodEnd: newSub.renewsAt
        ? Math.floor(newSub.renewsAt.getTime() / 1000)
        : null,
      plan: newSub.plan, // will be 'PLUS'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Webhook handler
 */
export async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Update your DB whenever Stripe notifies of status changes
  if (
    ['invoice.payment_succeeded', 'invoice.payment_failed', 
     'customer.subscription.updated', 'customer.subscription.deleted']
      .includes(event.type)
  ) {
    const sub = event.data.object;
    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: sub.status.toUpperCase(),
          renewsAt: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : existing.renewsAt,
          cancelsAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : undefined,
        },
      });
    }
  }

  res.json({ received: true });
}

/**
 * POST /api/payments/cancel-subscription
 */
router.post('/cancel-subscription', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Missing subscriptionId' });
    }

    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!sub || sub.userId !== userId) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Cancel in Stripe
    const canceled = await stripe.subscriptions.del(subscriptionId);

    // Mirror in your DB
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: canceled.status.toUpperCase(),
        cancelsAt: canceled.cancel_at
          ? new Date(canceled.cancel_at * 1000)
          : null,
      },
    });

    res.json({ success: true, status: canceled.status.toLowerCase() });
  } catch (err) {
    next(err);
  }
});

export const paymentsRouter = router;
