const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../db/postgres');
const { requireAdmin } = require('../middleware/auth');
const { triggerNow, reschedule } = require('../services/sync-scheduler');

const TEMPLATES_DIR = path.join(__dirname, '../../uploads/templates');

function safeFolder(folder) {
  const n = path.normalize(folder).replace(/\\/g, '/');
  return (n.includes('..') || n.includes('/')) ? null : n;
}

// All routes require admin
router.use(requireAdmin);

// POST /api/admin/sync
// Body: { scope: 'full'|'matches'|'events', tournamentId?, seasonId? }
router.post('/sync', async (req, res) => {
  const { scope = 'full', tournamentId, seasonId } = req.body;
  // Fire and forget — respond immediately, sync runs in background
  triggerNow(scope, tournamentId ? Number(tournamentId) : undefined, seasonId ? Number(seasonId) : undefined)
    .catch(err => console.error('[admin/sync]', err.message));
  res.json({ success: true, message: `Sync (${scope}) triggered` });
});

// GET /api/admin/sync/logs
router.get('/sync/logs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/sync/settings
router.get('/sync/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM sync_settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/sync/settings
// Body: { sync_interval_minutes: 30 }
router.put('/sync/settings', async (req, res) => {
  try {
    const { sync_interval_minutes } = req.body;
    const minutes = parseInt(sync_interval_minutes, 10);
    if (!minutes || minutes < 1) return res.status(400).json({ error: 'Invalid interval' });

    await pool.query(`
      INSERT INTO sync_settings (key, value, updated_at) VALUES ('sync_interval_minutes', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [String(minutes)]);

    reschedule(minutes);
    res.json({ success: true, sync_interval_minutes: minutes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/health
router.get('/health', async (req, res) => {
  try {
    const counts = await Promise.all([
      pool.query('SELECT COUNT(*) FROM matches'),
      pool.query('SELECT COUNT(*) FROM teams'),
      pool.query('SELECT COUNT(*) FROM sync_logs'),
    ]);
    res.json({
      db: 'connected',
      matches: parseInt(counts[0].rows[0].count, 10),
      teams: parseInt(counts[1].rows[0].count, 10),
      syncLogs: parseInt(counts[2].rows[0].count, 10),
    });
  } catch (e) {
    res.status(500).json({ db: 'error', error: e.message });
  }
});

// GET /api/admin/configs
router.get('/configs', (req, res) => {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) return res.json([]);

    const result = [];
    for (const folder of fs.readdirSync(TEMPLATES_DIR)) {
      const folderPath = path.join(TEMPLATES_DIR, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;
      for (const file of fs.readdirSync(folderPath)) {
        if (!file.endsWith('.pfl.json')) continue;
        const templateName = file.replace('.pfl.json', '');
        try {
          const config = JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf8'));
          result.push({ folder, template: templateName, config });
        } catch {
          result.push({ folder, template: templateName, config: null, error: 'parse error' });
        }
      }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/configs/:folder/:template
router.get('/configs/:folder/:template', (req, res) => {
  const folder = safeFolder(req.params.folder);
  const template = safeFolder(req.params.template);
  if (!folder || !template) return res.status(400).json({ error: 'Invalid path' });

  const filePath = path.join(TEMPLATES_DIR, folder, `${template}.pfl.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Config not found' });

  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    res.status(500).json({ error: 'Parse error' });
  }
});

// PUT /api/admin/configs/:folder/:template
router.put('/configs/:folder/:template', (req, res) => {
  const folder = safeFolder(req.params.folder);
  const template = safeFolder(req.params.template);
  if (!folder || !template) return res.status(400).json({ error: 'Invalid path' });

  const folderPath = path.join(TEMPLATES_DIR, folder);
  if (!fs.existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found' });

  const filePath = path.join(folderPath, `${template}.pfl.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Write failed' });
  }
});

module.exports = router;
