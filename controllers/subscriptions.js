// controllers/subscriptions.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
router.use(requireAuth);

async function findSub(id, uid) {
  const s = await prisma.subscription.findUnique({ where: { id } });
  return s?.userId === uid ? s : null;
}

// GET current subscription
router.get('/', async (req, res) => {
  const paid = await prisma.subscription.findFirst({
    where: { userId: req.user.id, status: 'ACTIVE', plan: { not: 'FREE' } }
  });
  if (!paid) {
    return res.json({ subscriptionId: null, status: 'free', currentPeriodEnd: null, plan: 'FREE', cancelAt: null });
  }
  res.json({
    subscriptionId: paid.stripeSubscriptionId,
    status: paid.status.toLowerCase(),
    currentPeriodEnd: paid.renewsAt ? Math.floor(paid.renewsAt.getTime()/1000) : null,
    plan: paid.plan,
    cancelAt: paid.cancelsAt ? Math.floor(paid.cancelsAt.getTime()/1000) : null
  });
});

// CRUD: GET by id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  res.json(sub);
});

// CREATE
router.post('/', async (req, res) => {
  const { plan, status, beganAt, renewsAt, cancelsAt } = req.body;
  const sub = await prisma.subscription.create({
    data: { userId: req.user.id, plan, status, beganAt, renewsAt, cancelsAt }
  });
  res.status(201).json(sub);
});

// UPDATE
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: req.body.status, renewsAt: req.body.renewsAt, cancelsAt: req.body.cancelsAt }
  });
  res.json(updated);
});

// DELETE
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  await prisma.subscription.delete({ where: { id } });
  res.status(204).end();
});

export default router;
