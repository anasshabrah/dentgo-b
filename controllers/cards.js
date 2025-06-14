// controllers/cards.js
import express from 'express';
import { ZodError } from 'zod';

import prisma from '../lib/prismaClient.js';
import { stripe } from '../lib/config.js';
import { ensureCustomer } from '../lib/stripeHelpers.js';
import requireAuth from '../middleware/requireAuth.js';
import { addCardSchema, updateCardSchema } from '../lib/schemas.js';

const router = express.Router();
router.use(requireAuth);

/** GET /api/cards */
router.get('/', async (req, res, next) => {
  try {
    const cards = await prisma.card.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(cards);
  } catch (err) {
    next(err);
  }
});

/** GET /api/cards/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const card = await prisma.card.findUnique({ where: { id } });
    if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Card not found' });
    res.json(card);
  } catch (err) {
    next(err);
  }
});

/** POST /api/cards */
router.post('/', async (req, res, next) => {
  try {
    const { paymentMethodId, nickName } = addCardSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const customerId = await ensureCustomer(user);

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (!pm.card) return res.status(400).json({ error: 'Not a card payment method' });

    const { brand, funding, last4, exp_month, exp_year } = pm.card;
    const newCard = await prisma.card.create({
      data: {
        paymentMethodId,
        network: brand.toUpperCase(),
        type: funding === 'debit' ? 'DEBIT' : 'CREDIT',
        last4,
        expiryMonth: exp_month,
        expiryYear: exp_year,
        nickName: nickName ?? null,
        isActive: true,
        userId: req.user.id
      }
    });
    res.status(201).json(newCard);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    next(err);
  }
});

/** PUT /api/cards/:id */
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updates = updateCardSchema.parse(req.body);

    const card = await prisma.card.findUnique({ where: { id } });
    if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Card not found' });

    const updated = await prisma.card.update({
      where: { id },
      data: updates
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    next(err);
  }
});

/** DELETE /api/cards/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const card = await prisma.card.findUnique({ where: { id } });
    if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Card not found' });

    await prisma.card.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
