const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../db/postgres');
const { requireAdmin } = require('../middleware/auth');
const { triggerNow, reschedule, rebuildTournamentSchedules } = require('../services/sync-scheduler');

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
  const { scope = 'full', tournamentId, seasonId, tourId, tourTitle } = req.body;
  // Fire and forget — respond immediately, sync runs in background
  triggerNow(
    scope,
    tournamentId ? Number(tournamentId) : undefined,
    seasonId ? Number(seasonId) : undefined,
    tourId ? Number(tourId) : undefined,
    tourTitle || undefined
  ).catch(err => console.error('[admin/sync]', err.message));
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
// Body: { sync_interval_minutes?, sync_enabled? }
router.put('/sync/settings', async (req, res) => {
  try {
    const { sync_interval_minutes, sync_enabled } = req.body;

    if (sync_interval_minutes !== undefined) {
      const minutes = parseInt(sync_interval_minutes, 10);
      if (!minutes || minutes < 1) return res.status(400).json({ error: 'Invalid interval' });
      await pool.query(`
        INSERT INTO sync_settings (key, value, updated_at) VALUES ('sync_interval_minutes', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, [String(minutes)]);
    }

    if (sync_enabled !== undefined) {
      await pool.query(`
        INSERT INTO sync_settings (key, value, updated_at) VALUES ('sync_enabled', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `, [String(sync_enabled)]);
    }

    const { rows } = await pool.query(
      "SELECT key, value FROM sync_settings WHERE key IN ('sync_interval_minutes', 'sync_enabled')"
    );
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    reschedule(parseInt(s.sync_interval_minutes || '60', 10), s.sync_enabled !== 'false');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/tournament-sync-configs
router.get('/tournament-sync-configs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tournament_sync_configs ORDER BY tournament_id, season_id NULLS LAST'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/tournament-sync-configs
router.post('/tournament-sync-configs', async (req, res) => {
  try {
    const {
      tournament_id, season_id, name,
      matches_interval_minutes = 60, matches_enabled = false,
      events_interval_minutes = 60, events_enabled = false,
      standings_interval_minutes = 60, standings_enabled = false,
    } = req.body;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required' });

    const { rows } = await pool.query(`
      INSERT INTO tournament_sync_configs
        (tournament_id, season_id, name,
         matches_interval_minutes, matches_enabled,
         events_interval_minutes, events_enabled,
         standings_interval_minutes, standings_enabled,
         updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `, [
      Number(tournament_id), season_id ? Number(season_id) : null, name || null,
      Number(matches_interval_minutes), Boolean(matches_enabled),
      Number(events_interval_minutes), Boolean(events_enabled),
      Number(standings_interval_minutes), Boolean(standings_enabled),
    ]);

    await rebuildTournamentSchedules();
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/tournament-sync-configs/:id
router.put('/tournament-sync-configs/:id', async (req, res) => {
  try {
    const {
      name,
      matches_interval_minutes, matches_enabled,
      events_interval_minutes, events_enabled,
      standings_interval_minutes, standings_enabled,
    } = req.body;
    const { rows } = await pool.query(`
      UPDATE tournament_sync_configs SET
        name                       = COALESCE($1, name),
        matches_interval_minutes   = COALESCE($2, matches_interval_minutes),
        matches_enabled            = COALESCE($3, matches_enabled),
        events_interval_minutes    = COALESCE($4, events_interval_minutes),
        events_enabled             = COALESCE($5, events_enabled),
        standings_interval_minutes = COALESCE($6, standings_interval_minutes),
        standings_enabled          = COALESCE($7, standings_enabled),
        updated_at = NOW()
      WHERE id = $8 RETURNING *
    `, [
      name !== undefined ? (name || null) : null,
      matches_interval_minutes != null ? Number(matches_interval_minutes) : null,
      matches_enabled != null ? Boolean(matches_enabled) : null,
      events_interval_minutes != null ? Number(events_interval_minutes) : null,
      events_enabled != null ? Boolean(events_enabled) : null,
      standings_interval_minutes != null ? Number(standings_interval_minutes) : null,
      standings_enabled != null ? Boolean(standings_enabled) : null,
      Number(req.params.id),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await rebuildTournamentSchedules();
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/tournament-sync-configs/:id
router.delete('/tournament-sync-configs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tournament_sync_configs WHERE id = $1', [Number(req.params.id)]);
    await rebuildTournamentSchedules();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/events
// Body: { tournamentId, seasonId? }
// Clears home_score/away_score and deletes player cards for matching matches
router.delete('/events', async (req, res) => {
  const { tournamentId, seasonId } = req.body;
  if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });

  try {
    const conditions = ['m.tournament_id = (SELECT id FROM tournaments WHERE pfl_id = $1)'];
    const params = [Number(tournamentId)];

    if (seasonId) {
      params.push(Number(seasonId));
      conditions.push(`m.season_id = (SELECT id FROM seasons WHERE pfl_id = $${params.length})`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    // Delete cards for affected matches
    await pool.query(
      `DELETE FROM player_match_cards WHERE match_id IN (SELECT id FROM matches m ${where})`,
      params
    );

    // Reset scores
    const upd = await pool.query(
      `UPDATE matches m SET home_score = NULL, away_score = NULL, updated_at = NOW() ${where}`,
      params
    );

    res.json({ success: true, matchesCleared: upd.rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/tour-dropdowns
router.get('/tour-dropdowns', (req, res) => {
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) return res.json([]);
    const result = [];
    for (const folder of fs.readdirSync(TEMPLATES_DIR).sort()) {
      const folderPath = path.join(TEMPLATES_DIR, folder);
      const filePath = path.join(folderPath, 'dropdown-tour.json');
      if (!fs.existsSync(filePath)) continue;

      // Discover tournamentId from the first .pfl.json in this folder
      let tournamentId = null;
      try {
        for (const f of fs.readdirSync(folderPath)) {
          if (!f.endsWith('.pfl.json')) continue;
          const cfg = JSON.parse(fs.readFileSync(path.join(folderPath, f), 'utf8'));
          if (cfg.tournamentId) { tournamentId = cfg.tournamentId; break; }
        }
      } catch { /* ignore */ }

      try {
        result.push({ folder, tournamentId, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) });
      } catch {
        result.push({ folder, tournamentId, data: null, error: 'parse error' });
      }
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/tour-dropdowns/:folder
router.put('/tour-dropdowns/:folder', (req, res) => {
  const folder = safeFolder(req.params.folder);
  if (!folder) return res.status(400).json({ error: 'Invalid path' });
  const filePath = path.join(TEMPLATES_DIR, folder, 'dropdown-tour.json');
  if (!fs.existsSync(path.join(TEMPLATES_DIR, folder))) return res.status(404).json({ error: 'Folder not found' });
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Write failed' });
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
