// middleware/requireAuth.js
import jwt from 'jsonwebtoken';

export default function requireAuth(req, res, next) {
  // SAME cookie name the auth layer sets:
  const token = req.cookies.access;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
