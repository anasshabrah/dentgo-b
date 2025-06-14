// controllers/payments.js
import express from 'express';
import { ZodError } from 'zod';

import prisma from '../lib/prismaClient.js';
import { stripe } from '../lib/config.js';
import { ensureCustomer } from '../lib/stripeHelpers.js';
import requireAuth from '../middleware/requireAuth.js';
import {
  paymentIntentSchema,
  subscriptionStripeCreateSchema,
  subscriptionCancelSchema
} from '../lib/schemas.js';

export const paymentsRouter = express.Router();
paymentsRouter.use(requireAuth);

paymentsRouter.post('/create-customer', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const customerId = user.stripeCustomerId || await ensureCustomer(user);
    res.json({ customerId });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post('/create-setup-intent', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const customerId = user.stripeCustomerId || await ensureCustomer(user);
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session'
    });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post('/create-payment-intent', async (req, res, next) => {
  try {
    const { amount, currency } = paymentIntentSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const customerId = user.stripeCustomerId || await ensureCustomer(user);
    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true }
    });
    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

paymentsRouter.post('/create-subscription', async (req, res, next) => {
  try {
    const { plan, priceId, paymentMethodId } = subscriptionStripeCreateSchema.parse(req.body);
    const uid = req.user.id;

    // FREE plan shortcut
    if (plan === 'FREE') {
      const existing = await prisma.subscription.findFirst({
        where: { userId: uid, plan: 'FREE', status: 'ACTIVE' }
      });
      if (existing) {
        return res.json({
          subscriptionId: existing.stripeSubscriptionId,
          status: existing.status.toLowerCase(),
          currentPeriodEnd: existing.renewsAt
            ? Math.floor(existing.renewsAt.getTime() / 1000)
            : null,
          plan: 'FREE'
        });
      }
      await prisma.subscription.create({
        data: { userId: uid, plan: 'FREE', status: 'ACTIVE', beganAt: new Date(), renewsAt: null }
      });
      return res.json({ subscriptionId: null, status: 'free', currentPeriodEnd: null, plan: 'FREE' });
    }

    // PLUS plan
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Missing paymentMethodId' });
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    // ← Fixed: fallback to ensureCustomer if stripeCustomerId is null
    const customerId = user.stripeCustomerId || await ensureCustomer(user);

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    const stripeSub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent']
    });

    const dbSub = await prisma.subscription.create({
      data: {
        userId: uid,
        plan,
        status: stripeSub.status.toUpperCase(),
        beganAt: new Date(stripeSub.created * 1000),
        renewsAt: stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000)
          : null,
        stripeSubscriptionId: stripeSub.id,
        stripePriceId: priceId
      }
    });

    const intent = stripeSub.latest_invoice?.payment_intent;
    res.json({
      subscriptionId: dbSub.stripeSubscriptionId,
      clientSecret: intent?.client_secret ?? null,
      status: stripeSub.status.toLowerCase(),
      currentPeriodEnd: dbSub.renewsAt
        ? Math.floor(dbSub.renewsAt.getTime() / 1000)
        : null,
      plan
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

paymentsRouter.post('/cancel-subscription', async (req, res, next) => {
  try {
    const { subscriptionId } = subscriptionCancelSchema.parse(req.body);
    const sub = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!sub || sub.userId !== req.user.id) return res.status(404).json({ error: 'Subscription not found' });

    const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: updated.status.toUpperCase(),
        cancelsAt: updated.cancel_at ? new Date(updated.cancel_at * 1000) : sub.cancelsAt
      }
    });

    res.json({
      success: true,
      status: updated.status.toLowerCase(),
      cancelAt: updated.cancel_at
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

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
    console.error('Webhook error', err.message);
    return res.status(400).send(`Error: ${err.message}`);
  }

  if ([
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ].includes(event.type)) {
    const s = event.data.object;
    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: s.id }
    });
    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: s.status.toUpperCase(),
          renewsAt: s.current_period_end
            ? new Date(s.current_period_end * 1000)
            : existing.renewsAt,
          cancelsAt: s.cancel_at
            ? new Date(s.cancel_at * 1000)
            : existing.cancelsAt
        }
      });
    }
  }

  res.json({ received: true });
}
