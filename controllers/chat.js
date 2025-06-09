// File: controllers/chat.js
import express from 'express';
import { OpenAI } from 'openai';
import prisma from '../lib/prismaClient.js';

const router = express.Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SYSTEM_CHECK =
  'Only answer YES or NO. Is this conversation about clinical dentistry, dental biomaterials, or dental procedures? ' +
  'Consider the entire chat history, not just the last message.';

router.post('/', async (req, res) => {
  try {
    const { prompt, history = [], sessionId, title } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid prompt' });
    }

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    let session;
    if (sessionId) {
      session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }
    } else {
      session = await prisma.chatSession.create({
        data: {
          userId,
          title: title || `Session ${new Date().toLocaleString()}`,
        },
      });
    }

    await prisma.message.create({
      data: {
        chatId: session.id,
        role: 'USER',
        content: prompt,
      },
    });

    const gateMessages = [
      { role: 'system', content: SYSTEM_CHECK },
      ...history.map(({ role, text }) => ({ role, content: text })),
      { role: 'user', content: prompt },
    ];

    const gateResp = await openai.chat.completions.create({
      model: process.env.GPT_MODEL || 'gpt-4o',
      messages: gateMessages,
    });

    const gateText = gateResp.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
    const isDental = gateText.startsWith('yes');

    if (!isDental) {
      const refusal =
        'I’m sorry, but DentAssist AI can only answer questions about clinical dentistry, dental biomaterials, or dental procedures.';
      await prisma.message.create({
        data: {
          chatId: session.id,
          role: 'BOT',
          content: refusal,
        },
      });
      return res.json({
        sessionId: session.id,
        answer: refusal,
        modelUsed: null,
        dental: false,
      });
    }

    const targetModel = process.env.GPT_MODEL;
    if (!targetModel) {
      console.error('❌ GPT_MODEL missing from .env');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const chatMessages = [
      {
        role: 'system',
        content:
          'You are DentAssist AI – a professional dental assistant. Format replies with clear headings, bullet points, ' +
          "and add a '🔍 References' section when appropriate.",
      },
      ...history.map(({ role, text }) => ({ role, content: text })),
      { role: 'user', content: prompt },
    ];

    const answerResp = await openai.chat.completions.create({
      model: targetModel,
      messages: chatMessages,
    });

    const answer = answerResp.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('No response from AI');

    await prisma.message.create({
      data: {
        chatId: session.id,
        role: 'BOT',
        content: answer,
      },
    });

    res.json({
      sessionId: session.id,
      answer,
      modelUsed: targetModel,
      dental: true,
    });
  } catch (err) {
    console.error('💥 Chat route error:', err);
    res.status(500).json({ error: 'AI service failed' });
  }
});

export default router;
