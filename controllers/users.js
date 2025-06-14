// controllers/users.js
import express from 'express';
import { ZodError } from 'zod';
import prisma from '../lib/prismaClient.js';
import { createUserSchema, updateUserSchema } from '../lib/schemas.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

// GET /api/users/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// GET all users
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// GET user by id
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// CREATE user
router.post('/', async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return res.status(409).json({ error: 'Email already in use' });
    const user = await prisma.user.create({ data });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    next(err);
  }
});

// UPDATE user
router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateUserSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id }, data });
    res.json(user);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Not found' });
    }
    next(err);
  }
});

// DELETE user
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Not found' });
    }
    next(err);
  }
});

export default router;
