// middleware/requireAuth.js
import jwt from 'jsonwebtoken';

export default function requireAuth(req, res, next) {
  const token = req.cookies.access;
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.userId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
