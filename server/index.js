require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRouter = require('./routes/auth');
const imagesRouter = require('./routes/images');
const templatesRouter = require('./routes/templates');
const fontsRouter = require('./routes/fonts');
const pflRouter = require('./routes/pfl');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin: isProd ? false : (process.env.CORS_ORIGIN || 'http://localhost:5173'),
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/images', imagesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/pfl', pflRouter);

// Generic R2-replacement route (mounted separately so it doesn't conflict)
const { Router } = require('express');
const r2Router = Router();
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
const safePath = p => {
  const n = path.normalize(p).replace(/\\/g, '/');
  return n.startsWith('..') ? null : n;
};
r2Router.get('/get/:filename', (req, res) => {
  const safe = safePath(req.params.filename);
  if (!safe) return res.status(400).json({ error: 'Invalid path' });
  const filePath = path.join(uploadDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(filePath);
});
app.use('/api/r2', r2Router);

app.get('/search-fonts', (req, res, next) => {
  req.url = '/search-fonts';
  fontsRouter(req, res, next);
});
app.use('/fonts', fontsRouter);

// ── Production: serve Vite build ──────────────────────────────────────────────

if (isProd) {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!isProd) {
    console.log('Vite dev server should be running on http://localhost:5173');
  }
});
