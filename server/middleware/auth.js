const pool = require('../db/postgres');

async function getSessionUser(req) {
  const token = req.cookies?.auth_token;
  if (!token) return null;

  const sessionRes = await pool.query(
    'SELECT email FROM sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  if (!sessionRes.rows[0]) return null;

  const userRes = await pool.query(
    'SELECT email, name, role FROM users WHERE email = $1',
    [sessionRes.rows[0].email]
  );
  return userRes.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

module.exports = { getSessionUser, requireAuth, requireAdmin };
