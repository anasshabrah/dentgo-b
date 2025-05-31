// cb/routes/users.js
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prismaClient');

// Utility: Validate user input (basic)
function validateUserInput({ name, email, role }) {
  if (!name || typeof name !== 'string') return 'Invalid or missing "name"';
  if (!email || typeof email !== 'string') return 'Invalid or missing "email"';
  if (role && !['USER', 'ADMIN'].includes(role)) return 'Invalid "role"';
  return null;
}

// GET /api/users/me – Return the authenticated user
router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

// GET /api/users – List all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.json(users);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id – Get a single user by ID
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: true,
        chats: true,
        notifications: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users – Create a new user
router.post('/', async (req, res) => {
  const { name, email, picture, role } = req.body;
  const validationError = validateUserInput({ name, email, role });
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const user = await prisma.user.create({
      data: { name, email, picture, role: role || 'USER' },
    });
    res.status(201).json(user);
  } catch (err) {
    console.error('POST /api/users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id – Update user
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

  const { name, email, picture, role } = req.body;
  const validationError = validateUserInput({ name, email, role });
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { name, email, picture, role },
    });
    res.json(user);
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id – Delete user
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
