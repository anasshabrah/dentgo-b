// backend/controllers/subscriptions.js
import express from 'express';
import prisma from '../lib/prismaClient.js';

const router = express.Router();

async function findSub(id, userId) {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub || sub.userId !== userId) return null;
  return sub;
}

/* GET /api/subscriptions */
router.get('/', async (req, res) => {
  try {
    // Try to find an active paid subscription
    const sub = await prisma.subscription.findFirst({
      where: { userId: req.user.id, status: 'ACTIVE' },
    });

    // If none, explicitly return the Free plan
    if (!sub) {
      return res.json({
        subscriptionId: null,
        status: 'free',
        currentPeriodEnd: null,
        plan: 'FREE',
      });
    }

    // Otherwise map your paid sub
    return res.json({
      subscriptionId: sub.stripeSubscriptionId,
      status: sub.status.toLowerCase(),
      currentPeriodEnd: sub.renewsAt
        ? Math.floor(sub.renewsAt.getTime() / 1000)
        : null,
      plan: sub.plan, // e.g. "PLUS"
    });
  } catch (err) {
    console.error('GET /api/subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* GET /api/subscriptions/:id */
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid subscription ID' });
  }

  const sub = await findSub(id, req.user.id);
  if (!sub) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  res.json(sub);
});

/* POST /api/subscriptions */
router.post('/', async (req, res) => {
  const { plan, status, beganAt, renewsAt, cancelsAt } = req.body;
  try {
    const sub = await prisma.subscription.create({
      data: {
        userId: req.user.id,
        plan,
        status,
        beganAt,
        renewsAt,
        cancelsAt,
      },
    });
    res.status(201).json(sub);
  } catch (err) {
    console.error('POST /api/subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* PUT /api/subscriptions/:id */
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, renewsAt, cancelsAt } = req.body;
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid subscription ID' });
  }

  const existing = await findSub(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  try {
    const updated = await prisma.subscription.update({
      where: { id },
      data: { status, renewsAt, cancelsAt },
    });
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/subscriptions/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* DELETE /api/subscriptions/:id */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid subscription ID' });
  }

  const existing = await findSub(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: 'Subscription not found' });
  }

  try {
    await prisma.subscription.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/subscriptions/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
