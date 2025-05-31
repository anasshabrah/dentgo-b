require("dotenv").config({ override: true });

const express = require("express");
const router = express.Router();
const { OpenAI } = require("openai");
const prisma = require("../lib/prismaClient");

// Init OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in environment");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple gate to filter dental-only conversations
const SYSTEM_CHECK =
  "Only answer YES or NO. Is this conversation about clinical dentistry, dental biomaterials, or dental procedures? " +
  "Consider the entire chat history, not just the last message.";

/**
 * POST /api/chat
 * Body: { prompt, history?: [{role:'user'|'assistant',text}], sessionId?, title? }
 */
router.post("/", async (req, res) => {
  try {
    const { prompt, history = [], sessionId, title } = req.body;
    if (!prompt || typeof prompt !== "string")
      return res.status(400).json({ error: "Missing or invalid prompt" });

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Find or create a chat session
    let session;
    if (sessionId) {
      session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!session) return res.status(404).json({ error: "Chat session not found" });
    } else {
      session = await prisma.chatSession.create({
        data: {
          userId,
          title: title || `Session ${new Date().toLocaleString()}`,
        },
      });
    }

    // Persist user message
    await prisma.message.create({
      data: {
        chatId: session.id,
        role: "USER",
        content: prompt,
      },
    });

    // Gate step: include full history + latest user turn
    const gateMessages = [
      { role: "system", content: SYSTEM_CHECK },
      ...history.map(({ role, text }) => ({ role, content: text })),
      { role: "user", content: prompt },
    ];

    const gateResp = await openai.chat.completions.create({
      model: process.env.GPT_MODEL || "gpt-4o",
      messages: gateMessages,
    });

    const gateText = gateResp.choices?.[0]?.message?.content?.trim().toLowerCase() || "";
    const isDental = gateText.startsWith("yes");

    if (!isDental) {
      const refusal =
        "I’m sorry, but DentAssist AI can only answer questions about clinical dentistry, dental biomaterials, or dental procedures.";
      await prisma.message.create({
        data: {
          chatId: session.id,
          role: "BOT",
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

    // Real answer: include full history + latest user turn
    const targetModel = process.env.GPT_MODEL;
    if (!targetModel) {
      console.error("❌ GPT4T_MODEL missing from .env");
      return res.status(500).json({ error: "Server misconfiguration" });
    }

    const chatMessages = [
      {
        role: "system",
        content:
          "You are DentAssist AI – a professional dental assistant. Format replies with clear headings, bullet points, " +
          "and add a '🔍 References' section when appropriate.",
      },
      ...history.map(({ role, text }) => ({ role, content: text })),
      { role: "user", content: prompt },
    ];

    const answerResp = await openai.chat.completions.create({
      model: targetModel,
      messages: chatMessages,
    });

    const answer = answerResp.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("No response from AI");

    // Persist assistant answer
    await prisma.message.create({
      data: {
        chatId: session.id,
        role: "BOT",
        content: answer,
      },
    });

    // Return
    res.json({
      sessionId: session.id,
      answer,
      modelUsed: targetModel,
      dental: true,
    });
  } catch (err) {
    console.error("💥 Chat route error:", err);
    res.status(500).json({ error: "AI service failed" });
  }
});

module.exports = router;
