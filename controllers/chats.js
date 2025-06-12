// File: controllers/chats.js
import express from 'express';
import prisma from '../lib/prismaClient.js';

const router = express.Router();

// GET /api/chats
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        startedAt: true,
        endedAt: true,
        isEnded: true,
      },
    });
    res.json(sessions);
  } catch (err) {
    console.error('GET /api/chats error:', err);
    res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
});

// GET /api/chats/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid session ID' });

  try {
    const session = await prisma.chatSession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        startedAt: true,
        endedAt: true,
        isEnded: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Chat session not found' });
    }
    res.json(session);
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch chat session' });
  }
});

// POST /api/chats
router.post('/', async (req, res) => {
  const { title } = req.body;
  if (title && typeof title !== 'string') {
    return res.status(400).json({ error: 'Invalid title' });
  }

  try {
    const session = await prisma.chatSession.create({
      data: { userId: req.user.id, title: title || null },
    });
    res.status(201).json(session);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// PATCH /api/chats/:id/end
router.patch('/:id/end', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title } = req.body;

  if (isNaN(id)) return res.status(400).json({ error: 'Invalid session ID' });

  try {
    const session = await prisma.chatSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    await prisma.chatSession.update({
      where: { id },
      data: {
        endedAt: new Date(),
        isEnded: true,
        isActive: false,
        ...(title ? { title } : {}),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/chats/:id/end error:', err);
    res.status(500).json({ error: 'Failed to end chat session' });
  }
});

export default router;
