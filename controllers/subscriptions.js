const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prismaClient');

/* GET /api/subscriptions – list user subscriptions */
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const subs   = await prisma.subscription.findMany({ where: { userId } });
  res.json(subs);
});

/* Utility to fetch & assert ownership */
async function findSub(id, userId) {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub || sub.userId !== userId) return null;
  return sub;
}

/* GET /api/subscriptions/:id */
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });
  res.json(sub);
});

/* POST /api/subscriptions – create */
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { plan, status, beganAt, renewsAt, cancelsAt } = req.body;
  const sub = await prisma.subscription.create({
    data: { plan, status, beganAt, renewsAt, cancelsAt, userId },
  });
  res.status(201).json(sub);
});

/* PUT /api/subscriptions/:id – update */
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  const { status, renewsAt, cancelsAt } = req.body;
  const updated = await prisma.subscription.update({
    where: { id },
    data : { status, renewsAt, cancelsAt },
  });
  res.json(updated);
});

/* DELETE /api/subscriptions/:id */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sub = await findSub(id, req.user.id);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  await prisma.subscription.delete({ where: { id } });
  res.status(204).end();
});

module.exports = router;
