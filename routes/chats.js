const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prismaClient');

// GET /api/chats - list all chat sessions for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, title: true, startedAt: true, endedAt: true }
    });
    res.json(sessions);
  } catch (err) {
    console.error('GET /api/chats error:', err);
    res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
});

// GET /api/chats/:id - fetch a single session and its messages
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid session ID' });

  try {
    const session = await prisma.chatSession.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } }
      }
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

// POST /api/chats - create a new chat session
router.post('/', async (req, res) => {
  const { title } = req.body;
  if (title && typeof title !== 'string') {
    return res.status(400).json({ error: 'Invalid title' });
  }

  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: req.user.id,
        title: title || null
      }
    });
    res.status(201).json(session);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// POST /api/chats/:id/messages - add a message to a chat session
router.post('/:id/messages', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { role, content } = req.body;
  if (isNaN(id) || !role || !content) {
    return res.status(400).json({ error: 'Invalid session ID or message data' });
  }
  if (!['USER', 'BOT'].includes(role)) {
    return res.status(400).json({ error: 'Invalid message role' });
  }

  try {
    const session = await prisma.chatSession.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const message = await prisma.message.create({
      data: {
        chatId: id,
        role,
        content
      }
    });
    res.status(201).json(message);
  } catch (err) {
    console.error('POST /api/chats/:id/messages error:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// PATCH /api/chats/:id/end - mark a chat session as ended
router.patch('/:id/end', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  try {
    const session = await prisma.chatSession.findUnique({
      where: { id }
    });
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    await prisma.chatSession.update({
      where: { id },
      data: { endedAt: new Date() }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/chats/:id/end error:', err);
    res.status(500).json({ error: 'Failed to end chat session' });
  }
});

module.exports = router;
