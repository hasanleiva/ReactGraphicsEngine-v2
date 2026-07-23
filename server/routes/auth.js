const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/postgres');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function cookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true';
  return { ...COOKIE_OPTIONS, secure };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existing = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, passwordHash, name || null, 'user']
    );

    const token = `tok_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      'INSERT INTO sessions (token, email, expires_at) VALUES ($1, $2, $3)',
      [token, email, expiresAt]
    );

    res.cookie('auth_token', token, cookieOptions());
    return res.json({ success: true, user: { email, name: name || null } });
  } catch (err) {
    console.error('[auth/signup]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = `tok_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      'INSERT INTO sessions (token, email, expires_at) VALUES ($1, $2, $3)',
      [token, email, expiresAt]
    );

    res.cookie('auth_token', token, cookieOptions());
    return res.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.auth_token;
    if (token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }
    res.clearCookie('auth_token', { path: '/' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/user
router.get('/user', requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

// POST /api/auth/password
router.post('/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [req.user.email]);
    const user = result.rows[0];

    if (!(await bcrypt.compare(oldPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Incorrect old password' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [newHash, req.user.email]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/password]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
