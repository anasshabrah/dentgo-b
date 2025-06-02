// backend/controllers/payments.js

const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const requireAuth = require("../middleware/requireAuth");

const prisma = new PrismaClient();

/**
 * ─── Create or retrieve a Stripe Customer for the authenticated user ───
 * POST /api/payments/create-customer
 */
router.post(
  "/create-customer",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
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

/**
 * ─── Create a SetupIntent for saving a card ───
 * POST /api/payments/create-setup-intent
 *
 * Body: none
 * Response: { clientSecret: string }
 *
 * Frontend must then do:
 *   const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
 *     payment_method: {
 *       card: CardElement,
 *       billing_details: { name: user.name, email: user.email }
 *     }
 *   });
 * Stripe will automatically attach the new PaymentMethod to the customer on success.
 */
router.post(
  "/create-setup-intent",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      // Fetch or create Stripe customer
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

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

      // Create SetupIntent for this customer
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: "off_session",
      });

      return res.json({ clientSecret: setupIntent.client_secret });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * ─── Create a one-time PaymentIntent ───
 * POST /api/payments/create-payment-intent
 *
 * Body: { amount: number, currency: string }
 * Response: { clientSecret: string }
 *
 * Frontend must then do:
 *   const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
 *     payment_method: {
 *       card: CardElement,
 *       billing_details: { name: user.name, email: user.email }
 *     }
 *   });
 */
router.post(
  "/create-payment-intent",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { amount, currency } = req.body || {};
      if (!amount || !currency) {
        return res
          .status(400)
          .json({ error: "Missing amount or currency in request body" });
      }

      // Ensure user has a Stripe customer
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

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

      // Create a PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        customer: customerId,
        automatic_payment_methods: { enabled: true },
      });

      return res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * ─── Create a new Subscription in Stripe and persist locally ───
 * POST /api/payments/create-subscription
 *
 * Body: { priceId: string, paymentMethodId: string }
 * Response:
 *   {
 *     subscriptionId: string,
 *     clientSecret: string,
 *     status: string
 *   }
 *
 * Frontend will do:
 *   stripe.confirmCardPayment(clientSecret)
 * (the Subscription creation returned client_secret on the first invoice)
 */
router.post(
  "/create-subscription",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.user.id;
      const { priceId: frontendPriceId, paymentMethodId } = req.body || {};

      const priceId = frontendPriceId || process.env.STRIPE_PRICE_ID;
      if (!priceId) {
        return res.status(400).json({ error: "No price ID provided" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user || !user.stripeCustomerId) {
        return res
          .status(400)
          .json({ error: "Stripe customer not found for user" });
      }

      // 1) Attach payment method to customer
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: user.stripeCustomerId,
      });

      // 2) Set it as default payment method on the customer
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      // 3) Create subscription on Stripe
      const subscription = await stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [{ price: priceId }],
        expand: ["latest_invoice.payment_intent"],
      });

      // 4) Record subscription in Prisma
      const newSub = await prisma.subscription.create({
        data: {
          plan:
            priceId.includes("plus")
              ? "PLUS"
              : priceId.includes("pro")
              ? "PRO"
              : "FREE",
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

/**
 * ─── Webhook handler (unprotected, raw JSON) ───
 */
async function webhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("⚠️  Webhook signature verification failed.", err.message);
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
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionUpdate(event.data.object);
      break;
    default:
      break;
  }

  res.json({ received: true });
}

module.exports = {
  webhookHandler,
  paymentsRouter: router,
};
