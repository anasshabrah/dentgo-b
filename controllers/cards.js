// controllers/cards.js
import express from 'express';
import prisma from '../lib/prismaClient.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

/**
 * GET /api/cards
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const cards = await prisma.card.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(cards);
  } catch (err) {
    console.error('GET /api/cards error:', err);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

/**
 * GET /api/cards/:id
 */
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid card ID' });

  try {
    const card = await prisma.card.findUnique({ where: { id } });
    if (!card || card.userId !== req.user.id) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(card);
  } catch (err) {
    console.error('GET /api/cards/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch card' });
  }
});

/**
 * POST /api/cards
 */
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { paymentMethodId, nickName } = req.body || {};

  if (!paymentMethodId) {
    return res.status(400).json({ error: 'Missing paymentMethodId in request body' });
  }

  try {
    // 1) Ensure we have a Stripe customer
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      // create in test mode
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      customerId = customer.id;
      user = await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // 2) Attach the PaymentMethod
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 3) Retrieve and persist card details
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const cardData = pm.card;
    if (!cardData) {
      return res.status(400).json({ error: 'PaymentMethod is not a card' });
    }

    const network = cardData.brand.toUpperCase();
    const type = cardData.funding === 'debit' ? 'DEBIT' : 'CREDIT';
    const newCard = await prisma.card.create({
      data: {
        paymentMethodId,
        type,
        network,
        last4: cardData.last4,
        expiryMonth: cardData.exp_month,
        expiryYear: cardData.exp_year,
        nickName: nickName || null,
        isActive: true,
        userId,
      },
    });

    res.status(201).json(newCard);
  } catch (err) {
    console.error('POST /api/cards error:', err);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

/**
 * PUT /api/cards/:id
 */
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nickName, isActive } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid card ID' });

  try {
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Card not found' });
    }

    const updated = await prisma.card.update({
      where: { id },
      data: { nickName, isActive },
    });
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/cards/:id error:', err);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

/**
 * DELETE /api/cards/:id
 */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid card ID' });

  try {
    const existing = await prisma.card.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Card not found' });
    }

    await prisma.card.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/cards/:id error:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

export default router;
