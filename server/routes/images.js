const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, getSessionUser } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const IMAGES_DIR = path.join(UPLOAD_DIR, 'images');
const META_DIR = path.join(UPLOAD_DIR, 'images-meta');

// Ensure directories exist
[IMAGES_DIR, META_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Use memory storage so we control where the file goes based on user role
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/images/upload
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file' });
    }

    const { buffer, mimetype, originalname } = req.file;

    if (req.user.role === 'admin') {
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(path.join(IMAGES_DIR, id), buffer);
      fs.writeFileSync(
        path.join(META_DIR, `${id}.json`),
        JSON.stringify({ mime: mimetype, originalName: originalname })
      );
      return res.json({ success: true, url: `/api/images/get/${id}` });
    } else {
      // Regular users: return base64 data URL (no server storage)
      const base64 = buffer.toString('base64');
      return res.json({ success: true, data: `data:${mimetype};base64,${base64}` });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/images/list
router.get('/list', async (req, res) => {
  try {
    const user = await getSessionUser(req);

    if (!user || user.role !== 'admin') {
      return res.json([]);
    }

    if (!fs.existsSync(IMAGES_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(IMAGES_DIR);
    const images = files.map(id => {
      let mime = 'image/png';
      const metaPath = path.join(META_DIR, `${id}.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          mime = meta.mime || mime;
        } catch {}
      }
      return {
        id,
        documentId: id,
        img: { url: `/api/images/get/${id}`, mime },
      };
    });

    return res.json(images);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/images/get/:id
router.get('/get/:id', (req, res) => {
  try {
    const { id } = req.params;
    // Prevent path traversal
    if (id.includes('/') || id.includes('..')) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const filePath = path.join(IMAGES_DIR, id);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    let mime = 'application/octet-stream';
    const metaPath = path.join(META_DIR, `${id}.json`);
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        mime = meta.mime || mime;
      } catch {}
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/images/remove/:id
router.delete('/remove/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    if (id.includes('/') || id.includes('..')) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const filePath = path.join(IMAGES_DIR, id);
    const metaPath = path.join(META_DIR, `${id}.json`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    fs.unlinkSync(filePath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
