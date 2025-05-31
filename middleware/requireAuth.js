const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role, ... }
    next();
  } catch (err) {
    console.error('JWT verify failed:', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
