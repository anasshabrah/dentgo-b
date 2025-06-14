// controllers/notifications.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
router.use(requireAuth);

// GET notifications
router.get('/', async (req, res) => {
  const notes = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(notes);
});

// MARK seen
router.post('/:id/seen', async (req, res) => {
  const id = Number(req.params.id);
  const note = await prisma.notification.findUnique({ where: { id } });
  if (!note || note.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  const updated = await prisma.notification.update({ where: { id }, data: { seen: true } });
  res.json(updated);
});

export default router;
