// routes/payments.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const requireAuth = require('../middleware/requireAuth');

const prisma = new PrismaClient();

// ─── Create or retrieve a Stripe Customer for the authenticated user ───
router.post(
  '/create-customer',
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

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

      return res.json({ customerId: customer.id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Create a new Subscription in Stripe and persist locally ───
router.post(
  '/create-subscription',
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { priceId, paymentMethodId } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.stripeCustomerId) {
        return res
          .status(400)
          .json({ error: 'Stripe customer not found for user' });
      }

      // Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: user.stripeCustomerId,
      });

      // Set it as default payment method
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      // Create subscription on Stripe
      const subscription = await stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [{ price: priceId }],
        expand: ['latest_invoice.payment_intent'],
      });

      // Record in Prisma
      const newSub = await prisma.subscription.create({
        data: {
          plan:
            priceId.includes('plus')
              ? 'PLUS'
              : priceId.includes('pro')
              ? 'PRO'
              : 'FREE',
          status: subscription.status.toUpperCase(),
          beganAt: new Date(subscription.created * 1000),
          renewsAt: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          userId: userId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
        },
      });

      return res.json({
        subscriptionId: subscription.id,
        clientSecret:
          subscription.latest_invoice.payment_intent.client_secret,
        status: subscription.status,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Stripe Webhook endpoint ───
router.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(
        '⚠️  Webhook signature verification failed.',
        err.message
      );
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

      await prisma.subscription.update({
        where: { id: existing.id },
        data: updates,
      });
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
);

module.exports = router;
