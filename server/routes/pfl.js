const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const PFL_BASE = 'https://api.pfl.uz/public/v1';
const TEMPLATES_DIR = path.join(__dirname, '../../uploads/templates');

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// Resolve "PRO/FIXTURES (GARB)" → { folder: "PRO", templateName: "FIXTURES (GARB)" }
function resolveTemplateId(templateId) {
  const safe = path.normalize(templateId).replace(/\\/g, '/');
  if (safe.startsWith('..') || safe.includes('..')) return null;
  const slashIdx = safe.indexOf('/');
  if (slashIdx === -1) return null;
  const folder = safe.slice(0, slashIdx);
  const templateName = safe.slice(slashIdx + 1);
  if (!folder || !templateName) return null;
  return { folder, templateName };
}

// ── Minimal flat XML parser / serializer (no dependencies) ───────────────────

function parseXml(xmlStr) {
  const result = {};
  const re = /<([\w-]+)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(xmlStr)) !== null) {
    const key = m[1];
    const raw = m[2].trim();
    if (raw === '' || raw.toLowerCase() === 'null') {
      result[key] = null;
    } else if (raw === 'true') {
      result[key] = true;
    } else if (raw === 'false') {
      result[key] = false;
    } else if (!isNaN(Number(raw))) {
      result[key] = Number(raw);
    } else {
      result[key] = raw;
    }
  }
  return result;
}

function toXml(obj) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<pfl-config>'];
  for (const [key, val] of Object.entries(obj)) {
    lines.push(`  <${key}>${val === null || val === undefined ? '' : val}</${key}>`);
  }
  lines.push('</pfl-config>');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

async function pflFetch(endpoint, query = {}) {
  const apiKey = process.env.PFL_API_KEY;
  if (!apiKey) throw new Error('PFL_API_KEY not configured in .env');

  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const url = `${PFL_BASE}${endpoint}${params.toString() ? '?' + params : ''}`;

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PFL API ${res.status}: ${text}`);
  }
  return res.json();
}

// GET /api/pfl/config/**
// Config file: uploads/templates/[FOLDER]/[TEMPLATE_NAME].pfl.json
router.get('/config/*', (req, res) => {
  const ids = resolveTemplateId(req.params[0]);
  if (!ids) return res.status(400).json({ error: 'Invalid template path' });

  const configPath = path.join(TEMPLATES_DIR, ids.folder, `${ids.templateName}.pfl.json`);
  if (!fs.existsSync(configPath)) {
    return res.status(404).json({
      error: `No config found. Create: uploads/templates/${ids.folder}/${ids.templateName}.pfl.json`,
    });
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: 'Failed to parse config file' });
  }
});

// POST /api/pfl/config/**  — saves config (admin only)
router.post('/config/*', requireAdmin, (req, res) => {
  const ids = resolveTemplateId(req.params[0]);
  if (!ids) return res.status(400).json({ error: 'Invalid template path' });

  const folderPath = path.join(TEMPLATES_DIR, ids.folder);
  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: `Template folder not found: ${ids.folder}` });
  }
  const configPath = path.join(folderPath, `${ids.templateName}.pfl.json`);
  try {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save config file' });
  }
});

// GET /api/pfl/standings/:tournamentId?seasonId=&groupId=
router.get('/standings/:tournamentId', async (req, res) => {
  try {
    const data = await pflFetch(`/standings/${req.params.tournamentId}`, {
      seasonId: req.query.seasonId,
      groupId: req.query.groupId,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pfl/matches?tournamentId=&seasonId=&tourId=&page=&limit=
router.get('/matches', async (req, res) => {
  try {
    const data = await pflFetch('/matches', {
      tournamentId: req.query.tournamentId,
      seasonId: req.query.seasonId,
      tourId: req.query.tourId,
      clubId: req.query.clubId,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pfl/matches/:id/events
router.get('/matches/:id/events', async (req, res) => {
  try {
    const data = await pflFetch(`/matches/${req.params.id}/events`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pfl/matches/:id
router.get('/matches/:id', async (req, res) => {
  try {
    const data = await pflFetch(`/matches/${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pfl/clubs
router.get('/clubs', async (req, res) => {
  try {
    const data = await pflFetch('/clubs');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
