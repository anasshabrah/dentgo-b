// controllers/chats.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();
router.use(requireAuth);

// GET list of sessions
router.get('/', async (req, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { userId: req.user.id },
    orderBy: { startedAt: 'desc' },
    select: { id: true, title: true, startedAt: true, endedAt: true, isEnded: true },
  });
  res.json(sessions);
});

// GET one session + messages
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const session = await prisma.chatSession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

// POST create session
router.post('/', async (req, res) => {
  const session = await prisma.chatSession.create({
    data: { userId: req.user.id, title: typeof req.body.title === 'string' ? req.body.title : null }
  });
  res.status(201).json(session);
});

// PATCH end session
router.patch('/:id/end', async (req, res) => {
  const id = Number(req.params.id);
  const session = await prisma.chatSession.findUnique({ where: { id } });
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

  await prisma.chatSession.update({
    where: { id },
    data: { endedAt: new Date(), isEnded: true, isActive: false, ...(req.body.title ? { title: req.body.title } : {}) },
  });
  res.json({ success: true });
});

export default router;
