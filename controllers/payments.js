// controllers/payments.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import { stripe } from '../lib/config.js';
import { ensureCustomer } from '../lib/stripeHelpers.js';
import requireAuth from '../middleware/requireAuth.js';

export const paymentsRouter = express.Router();
paymentsRouter.use(requireAuth);

// CREATE customer
paymentsRouter.post('/create-customer', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const cid = user.stripeCustomerId || await ensureCustomer(user);
    res.json({ customerId: cid });
  } catch (err) { next(err); }
});

// CREATE setup intent
paymentsRouter.post('/create-setup-intent', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const cid = user.stripeCustomerId || await ensureCustomer(user);
    const si = await stripe.setupIntents.create({ customer: cid, usage: 'off_session' });
    res.json({ clientSecret: si.client_secret });
  } catch (err) { next(err); }
});

// CREATE payment intent
paymentsRouter.post('/create-payment-intent', async (req, res, next) => {
  try {
    const { amount, currency } = req.body;
    if (typeof amount !== 'number' || !currency) return res.status(400).json({ error: 'Missing amount or currency' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const cid = user.stripeCustomerId || await ensureCustomer(user);
    const pi = await stripe.paymentIntents.create({ amount, currency, customer: cid, automatic_payment_methods: { enabled: true } });
    res.json({ clientSecret: pi.client_secret });
  } catch (err) { next(err); }
});

// CREATE subscription
paymentsRouter.post('/create-subscription', async (req, res, next) => {
  try {
    const { priceId = 'FREE', paymentMethodId } = req.body;
    const uid = req.user.id;

    if (priceId === 'FREE') {
      const existing = await prisma.subscription.findFirst({ where: { userId: uid, plan: 'FREE', status: 'ACTIVE' } });
      if (existing) {
        return res.json({
          subscriptionId: existing.stripeSubscriptionId,
          status: existing.status.toLowerCase(),
          currentPeriodEnd: existing.renewsAt ? Math.floor(existing.renewsAt.getTime()/1000) : null,
          plan: 'FREE'
        });
      }
      const free = await prisma.subscription.create({ data: { userId: uid, plan: 'FREE', status: 'ACTIVE', beganAt: new Date(), renewsAt: null } });
      return res.json({ subscriptionId: null, status: 'free', currentPeriodEnd: null, plan: 'FREE' });
    }

    // PLUS / paid plan
    const hasPlus = await prisma.subscription.findFirst({ where: { userId: uid, plan: priceId, status: 'ACTIVE' } });
    if (hasPlus) {
      return res.json({
        subscriptionId: hasPlus.stripeSubscriptionId,
        status: hasPlus.status.toLowerCase(),
        currentPeriodEnd: hasPlus.renewsAt ? Math.floor(hasPlus.renewsAt.getTime()/1000) : null,
        plan: priceId
      });
    }

    if (!paymentMethodId) return res.status(400).json({ error: 'Missing paymentMethodId' });
    const user = await prisma.user.findUnique({ where: { id: uid } });
    const cid = user.stripeCustomerId;
    await stripe.paymentMethods.attach(paymentMethodId, { customer: cid });
    await stripe.customers.update(cid, { invoice_settings: { default_payment_method: paymentMethodId } });

    const stripeSub = await stripe.subscriptions.create({
      customer: cid,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent']
    });

    const dbSub = await prisma.subscription.create({
      data: {
        userId: uid,
        plan: priceId,
        status: stripeSub.status.toUpperCase(),
        beganAt: new Date(stripeSub.created * 1000),
        renewsAt: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : null,
        stripeSubscriptionId: stripeSub.id
      }
    });

    const intent = stripeSub.latest_invoice?.payment_intent;
    res.json({
      subscriptionId: dbSub.stripeSubscriptionId,
      clientSecret: intent?.client_secret || null,
      status: stripeSub.status.toLowerCase(),
      currentPeriodEnd: dbSub.renewsAt ? Math.floor(dbSub.renewsAt.getTime()/1000) : null,
      plan: priceId
    });
  } catch (err) { next(err); }
});

// CANCEL subscription
paymentsRouter.post('/cancel-subscription', async (req, res, next) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId' });

    const sub = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!sub || sub.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

    const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: updated.status.toUpperCase(), cancelsAt: updated.cancel_at ? new Date(updated.cancel_at * 1000) : sub.cancelsAt }
    });

    res.json({ success: true, status: updated.status.toLowerCase(), cancelAt: updated.cancel_at });
  } catch (err) { next(err); }
});

// Webhook handler
export async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error', err.message);
    return res.status(400).send(`Error: ${err.message}`);
  }

  if (['invoice.payment_succeeded','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) {
    const s = event.data.object;
    const existing = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: s.id } });
    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: s.status.toUpperCase(),
          renewsAt: s.current_period_end ? new Date(s.current_period_end*1000) : existing.renewsAt,
          cancelsAt: s.cancel_at ? new Date(s.cancel_at*1000) : existing.cancelsAt
        }
      });
    }
  }

  res.json({ received: true });
}
