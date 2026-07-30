const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const TEMPLATES_DIR = path.join(UPLOAD_DIR, 'templates');

if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// Recursively collect all .json file paths relative to a base dir
function collectJsonFiles(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(full, rel));
    } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.pfl.json') && entry.name !== 'dropdown-tour.json') {
      results.push(rel.replace(/\.json$/, ''));
    }
  }
  return results;
}

function safePath(userPath) {
  const normalized = path.normalize(userPath).replace(/\\/g, '/');
  // Reject any path that tries to traverse up
  if (normalized.startsWith('..') || normalized.includes('/../')) return null;
  return normalized;
}

// GET /api/templates/list
router.get('/list', (req, res) => {
  try {
    const templates = collectJsonFiles(TEMPLATES_DIR, '');
    return res.json({ success: true, templates });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/templates/get/*
router.get('/get/*', (req, res) => {
  try {
    const rawPath = req.params[0];
    if (!rawPath) {
      return res.status(404).json({ error: 'Not found' });
    }

    const safe = safePath(rawPath);
    if (!safe) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const filePath = path.join(TEMPLATES_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return res.json({ success: true, content });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/save
router.post('/save', requireAdmin, (req, res) => {
  try {
    const { id, content } = req.body;
    if (!id || content === undefined) {
      return res.status(400).json({ error: 'id and content required' });
    }

    const safe = safePath(id);
    if (!safe) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const filePath = path.join(TEMPLATES_DIR, `${safe}.json`);
    const fileDir = path.dirname(filePath);

    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(content));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/templates/delete — admin only
router.delete('/delete', requireAdmin, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const safe = safePath(id);
    if (!safe) return res.status(400).json({ error: 'Invalid id' });

    const filePath = path.join(TEMPLATES_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

    fs.unlinkSync(filePath);

    // Remove empty parent directories (up to TEMPLATES_DIR)
    let dir = path.dirname(filePath);
    while (dir !== TEMPLATES_DIR) {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      } else break;
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/save-user — any authenticated user can overwrite an EXISTING template
router.post('/save-user', requireAuth, (req, res) => {
  try {
    const { id, content } = req.body;
    if (!id || content === undefined) {
      return res.status(400).json({ error: 'id and content required' });
    }

    const safe = safePath(id);
    if (!safe) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const filePath = path.join(TEMPLATES_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(403).json({ error: 'Template not found — users cannot create new templates' });
    }

    fs.writeFileSync(filePath, JSON.stringify(content));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/r2/get/:filename  — generic file serve from uploads dir
router.get('/r2/get/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const safe = safePath(filename);
    if (!safe) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const filePath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
