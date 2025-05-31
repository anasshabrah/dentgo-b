const express = require('express');
const router  = express.Router();
const prisma  = require('../lib/prismaClient');

/* GET /api/notifications – list user notifications */
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const notes  = await prisma.notification.findMany({
    where   : { userId },
    orderBy : { createdAt: 'desc' },
  });
  res.json(notes);
});

/* POST /api/notifications/:id/seen – mark as seen (ownership enforced) */
router.post('/:id/seen', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid notification ID' });

  const note = await prisma.notification.findUnique({ where: { id } });
  if (!note || note.userId !== req.user.id) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  const updated = await prisma.notification.update({
    where : { id },
    data  : { seen: true },
  });
  res.json(updated);
});

module.exports = router;
