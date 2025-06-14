// controllers/users.js
import express from 'express';

import prisma from '../lib/prismaClient.js';
import { normalizeEmail } from '../lib/normalize.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

// GET /api/users/me
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// GET all users
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  res.json(users);
});

// GET user by id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// POST create user
router.post('/', async (req, res) => {
  let { name, email, picture, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });
  email = normalizeEmail(email);

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: 'Email in use' });

  const user = await prisma.user.create({ data: { name, email, picture, role: role || 'USER' } });
  res.status(201).json(user);
});

// PUT update user
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  let { name, email, picture, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });
  email = normalizeEmail(email);

  try {
    const user = await prisma.user.update({ where: { id }, data: { name, email, picture, role } });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    throw err;
  }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    throw err;
  }
});

export default router;
