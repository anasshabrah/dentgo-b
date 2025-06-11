// controllers/payments.js
import express from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import requireAuth from '../middleware/requireAuth.js';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

/**
 * POST /api/payments/create-customer
 */
router.post('/create-customer', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });
    if (existingUser.stripeCustomerId) {
      return res.json({ customerId: existingUser.stripeCustomerId });
    }

    const customer = await stripe.customers.create({
      email: existingUser.email,
      name: existingUser.name,
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
router.post('/create-setup-intent', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    let existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    let customerId = existingUser.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: existingUser.email,
        name: existingUser.name,
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
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
router.post('/create-payment-intent', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { amount, currency } = req.body || {};
    if (!amount || !currency) {
      return res.status(400).json({ error: 'Missing amount or currency in request body' });
    }

    let existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    let customerId = existingUser.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: existingUser.email,
        name: existingUser.name,
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
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
router.post('/create-subscription', requireAuth, async (req, res, next) => {
  try {
    console.log('> create-subscription hit for user', req.user.id);

    const userId = req.user.id;
    const { priceId: frontendPriceId, paymentMethodId } = req.body || {};
    const priceId = frontendPriceId || 'FREE';

    // Free (Basic) plan: bypass Stripe
    if (priceId === 'FREE') {
      // Check for existing active FREE plan
      const existing = await prisma.subscription.findFirst({
        where: {
          userId,
          plan: 'FREE',
          status: 'ACTIVE',
        },
      });

      if (existing) {
        return res.json({
          subscriptionId: existing.id,
          status: existing.status.toLowerCase(),
          currentPeriodEnd: existing.renewsAt
            ? Math.floor(existing.renewsAt.getTime() / 1000)
            : null,
        });
      }

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
        subscriptionId: freeSub.id,
        status: 'active',
        currentPeriodEnd: null,
      });
    }

    // Paid plan: require paymentMethod
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Missing paymentMethodId' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripeCustomerId) {
      return res.status(400).json({ error: 'Stripe customer not found for user' });
    }

    // Attach payment method and set default
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Create Stripe subscription
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });

    const newSub = await prisma.subscription.create({
      data: {
        userId,
        plan: priceId.includes('plus') ? 'PLUS' : priceId.includes('pro') ? 'PRO' : 'UNKNOWN',
        status: subscription.status.toUpperCase(),
        beganAt: new Date(subscription.created * 1000),
        renewsAt: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
      },
    });

    const intent = subscription.latest_invoice.payment_intent;
    res.json({
      subscriptionId: newSub.stripeSubscriptionId,
      clientSecret: intent.client_secret,
      status: subscription.status,
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
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const handleSubscriptionUpdate = async (subscription) => {
    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!existing) return;

    const updates = {
      status: subscription.status.toUpperCase(),
      renewsAt: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : existing.renewsAt,
    };
    if (subscription.cancel_at) {
      updates.cancelsAt = new Date(subscription.cancel_at * 1000);
    }

    await prisma.subscription.update({ where: { id: existing.id }, data: updates });
  };

  switch (event.type) {
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionUpdate(event.data.object);
      break;
    default:
      break;
  }

  res.json({ received: true });
}

export const paymentsRouter = router;
