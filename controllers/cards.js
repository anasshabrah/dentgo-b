// controllers/cards.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import { stripe } from '../lib/config.js';
import { ensureCustomer } from '../lib/stripeHelpers.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
router.use(requireAuth);

// GET all cards
router.get('/', async (req, res) => {
  const cards = await prisma.card.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
  res.json(cards);
});

// GET single card
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const card = await prisma.card.findUnique({ where: { id } });
  if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(card);
});

// CREATE card
router.post('/', async (req, res) => {
  const { paymentMethodId, nickName } = req.body;
  if (!paymentMethodId) return res.status(400).json({ error: 'Missing paymentMethodId' });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const customerId = await ensureCustomer(user);

  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (!pm.card) return res.status(400).json({ error: 'Not a card PM' });

  const { brand, funding, last4, exp_month, exp_year } = pm.card;
  const newCard = await prisma.card.create({
    data: {
      paymentMethodId,
      network: brand.toUpperCase(),
      type: funding === 'debit' ? 'DEBIT' : 'CREDIT',
      last4,
      expiryMonth: exp_month,
      expiryYear: exp_year,
      nickName: nickName || null,
      isActive: true,
      userId: req.user.id,
    }
  });
  res.status(201).json(newCard);
});

// UPDATE card
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const card = await prisma.card.findUnique({ where: { id } });
  if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const updated = await prisma.card.update({
    where: { id },
    data: { nickName: req.body.nickName, isActive: req.body.isActive },
  });
  res.json(updated);
});

// DELETE card
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const card = await prisma.card.findUnique({ where: { id } });
  if (!card || card.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await prisma.card.delete({ where: { id } });
  res.status(204).end();
});

export default router;
