// backend/controllers/cards.js
const express = require("express");
const router = express.Router();
const prisma = require("../lib/prismaClient");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// All routes under /api/cards are already protected by requireAuth in server.js.

/**
 * GET /api/cards
 * → Return all saved cards for the authenticated user.
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const cards = await prisma.card.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return res.json(cards);
  } catch (err) {
    console.error("GET /api/cards error:", err);
    return res.status(500).json({ error: "Failed to fetch cards" });
  }
});

/**
 * GET /api/cards/:id
 * → Return a single card, ensuring it belongs to the authenticated user.
 */
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid card ID" });
  }

  try {
    const card = await prisma.card.findUnique({ where: { id } });
    if (!card || card.userId !== req.user.id) {
      return res.status(404).json({ error: "Card not found" });
    }
    return res.json(card);
  } catch (err) {
    console.error("GET /api/cards/:id error:", err);
    return res.status(500).json({ error: "Failed to fetch card" });
  }
});

/**
 * POST /api/cards
 * Body: { paymentMethodId: string, nickName?: string }
 *
 * 1. Verify user & stripeCustomerId.
 * 2. Attach the PaymentMethod to Stripe customer (already created via Setup Intent).
 * 3. Optionally make it the default payment method on the customer.
 * 4. Extract card details from Stripe's PaymentMethod object.
 * 5. Save a new Card row in Prisma.
 */
router.post("/", async (req, res) => {
  const userId = req.user.id;
  const { paymentMethodId, nickName } = req.body || {};

  if (!paymentMethodId) {
    return res.status(400).json({ error: "Missing paymentMethodId in request body" });
  }

  try {
    // 1) Fetch user to get stripeCustomerId
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (!user.stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "Stripe customer not found for user. Create one first." });
    }

    // 2) Attach the PaymentMethod to the existing Stripe Customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    // 3) Optionally make it the default payment method on the customer
    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 4) Retrieve PaymentMethod to read card details
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const cardData = pm.card;
    if (!cardData) {
      return res.status(400).json({ error: "PaymentMethod is not a card" });
    }

    const network = cardData.brand.toUpperCase(); // e.g. "VISA"
    const type = cardData.funding === "debit" ? "DEBIT" : "CREDIT";
    const last4 = cardData.last4;
    const expMonth = cardData.exp_month;
    const expYear = cardData.exp_year;

    // 5) Persist a new Card row
    const newCard = await prisma.card.create({
      data: {
        type,
        network,
        last4,
        expiryMonth: expMonth,
        expiryYear: expYear,
        nickName: nickName || null,
        isActive: true,
        userId,
      },
    });

    return res.status(201).json(newCard);
  } catch (err) {
    console.error("POST /api/cards error:", err);
    return res.status(500).json({ error: "Failed to create card" });
  }
});

/**
 * PUT /api/cards/:id
 * → Update only { nickName, isActive } for a card that belongs to the user.
 */
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nickName, isActive } = req.body;
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid card ID" });
  }

  try {
    // Ensure card belongs to user
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Card not found" });
    }

    const updated = await prisma.card.update({
      where: { id },
      data: { nickName, isActive },
    });
    return res.json(updated);
  } catch (err) {
    console.error("PUT /api/cards/:id error:", err);
    return res.status(500).json({ error: "Failed to update card" });
  }
});

/**
 * DELETE /api/cards/:id
 * → Remove a card that belongs to the user
 */
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid card ID" });
  }

  try {
    // Ensure card belongs to user
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: "Card not found" });
    }

    await prisma.card.delete({ where: { id } });
    return res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/cards/:id error:", err);
    return res.status(500).json({ error: "Failed to delete card" });
  }
});

module.exports = router;
