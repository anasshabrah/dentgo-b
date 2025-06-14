// controllers/subscriptions.js
import express from 'express';
import { ZodError } from 'zod';

import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';
import {
  subscriptionCreateSchema,
  subscriptionCancelSchema
} from '../lib/schemas.js';

const router = express.Router();
router.use(requireAuth);

async function findSub(id, uid) {
  const s = await prisma.subscription.findUnique({ where: { id } });
  return s?.userId === uid ? s : null;
}

// GET current
router.get('/', async (req, res, next) => {
  try {
    const paid = await prisma.subscription.findFirst({
      where: { userId: req.user.id, status: 'ACTIVE', plan: { not: 'FREE' } }
    });
    if (!paid) {
      return res.json({
        subscriptionId: null,
        status: 'free',
        currentPeriodEnd: null,
        plan: 'FREE',
        cancelAt: null
      });
    }
    res.json({
      subscriptionId: paid.stripeSubscriptionId,
      status: paid.status.toLowerCase(),
      currentPeriodEnd: paid.renewsAt
        ? Math.floor(paid.renewsAt.getTime() / 1000)
        : null,
      plan: paid.plan,
      cancelAt: paid.cancelsAt
        ? Math.floor(paid.cancelsAt.getTime() / 1000)
        : null
    });
  } catch (err) {
    next(err);
  }
});

// GET by ID
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = await findSub(id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    res.json(sub);
  } catch (err) {
    next(err);
  }
});

// CREATE
router.post('/', async (req, res, next) => {
  try {
    const { plan, status, beganAt, renewsAt, cancelsAt } = subscriptionCreateSchema.parse(req.body);
    const sub = await prisma.subscription.create({
      data: {
        userId: req.user.id,
        plan,
        status,
        beganAt,
        renewsAt,
        cancelsAt
      }
    });
    res.status(201).json(sub);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// UPDATE
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = await findSub(id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const { status, renewsAt, cancelsAt } = subscriptionCreateSchema.parse(req.body);
    const updated = await prisma.subscription.update({
      where: { id },
      data: { status, renewsAt, cancelsAt }
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

// DELETE
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sub = await findSub(id, req.user.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    await prisma.subscription.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
