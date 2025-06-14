// controllers/chat.js
import express from 'express';
import { ZodError } from 'zod';

import prisma from '../lib/prismaClient.js';
import { openai } from '../lib/config.js';
import requireAuth from '../middleware/requireAuth.js';
import {
  chatRequestSchema,
  chatCountSchema,
  chatEndSchema
} from '../lib/schemas.js';

const router = express.Router();
router.use(requireAuth);

const GATE_SYSTEM =
  'Only answer YES or NO. Is this conversation about clinical dentistry, dental biomaterials, or dental procedures?';
const ASSIST_SYSTEM =
  'You are DentAssist AI – a professional dental assistant. Format replies with clear headings, bullet points, and add a "🔍 References" section when appropriate.';

router.post('/', async (req, res, next) => {
  try {
    const { prompt, history, sessionId, title } = chatRequestSchema.parse(req.body);

    let session = sessionId
      ? await prisma.chatSession.findUnique({ where: { id: sessionId } })
      : await prisma.chatSession.create({ data: { userId: req.user.id, title: title ?? null } });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    await prisma.message.create({ data: { chatId: session.id, role: 'USER', content: prompt } });

    const gate = await openai.chat.completions.create({
      model: process.env.GPT_MODEL,
      messages: [
        { role: 'system', content: GATE_SYSTEM },
        ...(history ?? []).map(h => ({ role: h.role, content: h.text })),
        { role: 'user', content: prompt }
      ]
    });
    const ok = gate.choices[0].message.content.trim().toLowerCase().startsWith('yes');
    if (!ok) {
      const refusal = 'I’m sorry… only dental topics.';
      await prisma.message.create({ data: { chatId: session.id, role: 'BOT', content: refusal } });
      return res.json({ sessionId: session.id, answer: refusal, modelUsed: null, dental: false });
    }

    const answerResp = await openai.chat.completions.create({
      model: process.env.GPT_MODEL,
      messages: [
        { role: 'system', content: ASSIST_SYSTEM },
        ...(history ?? []).map(h => ({ role: h.role, content: h.text })),
        { role: 'user', content: prompt }
      ]
    });
    const answer = answerResp.choices[0].message.content.trim();
    await prisma.message.create({ data: { chatId: session.id, role: 'BOT', content: answer } });

    res.json({ sessionId: session.id, answer, modelUsed: process.env.GPT_MODEL, dental: true });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.get('/count', async (req, res, next) => {
  try {
    const { date } = chatCountSchema.parse(req.query);
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    const count = await prisma.message.count({
      where: {
        role: 'USER',
        createdAt: { gte: start, lte: end },
        chat: { userId: req.user.id }
      }
    });
    res.json({ date, count });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

router.post('/end', async (req, res, next) => {
  try {
    const { sessionId } = chatEndSchema.parse(req.body);
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), isEnded: true, isActive: false }
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
});

export default router;
