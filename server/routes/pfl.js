const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { pflFetch } = require('../lib/pfl-client');
const { requireAdmin } = require('../middleware/auth');
const pool = require('../db/postgres');

const TEMPLATES_DIR = path.join(__dirname, '../../uploads/templates');

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

// GET /api/pfl/tours/:folder — returns dropdown-tour.json for a template folder
router.get('/tours/:folder', (req, res) => {
  const folder = path.normalize(req.params.folder).replace(/\\/g, '/');
  if (folder.includes('..') || folder.includes('/')) {
    return res.status(400).json({ error: 'Invalid folder' });
  }
  const filePath = path.join(TEMPLATES_DIR, folder, 'dropdown-tour.json');
  if (!fs.existsSync(filePath)) return res.json([]);
  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    res.json([]);
  }
});

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
// Reads from local DB (populated by syncStandings)
router.get('/standings/:tournamentId', async (req, res) => {
  try {
    const { seasonId, groupId } = req.query;
    const params = [Number(req.params.tournamentId)];

    let q = `
      SELECT s.position, s.points, s.played, s.goals_for, s.goals_against,
             t.pfl_club_id, t.title, t.title_en, t.logo, t.code
      FROM standings s
      LEFT JOIN teams t ON t.pfl_club_id = s.pfl_club_id
      WHERE s.tournament_id = (SELECT id FROM tournaments WHERE pfl_id = $1)
    `;

    if (seasonId) {
      params.push(Number(seasonId));
      q += ` AND s.season_id = (SELECT id FROM seasons WHERE pfl_id = $${params.length})`;
    } else {
      q += ` AND s.season_id IS NULL`;
    }

    if (groupId) {
      params.push(Number(groupId));
      q += ` AND s.group_pfl_id = $${params.length}`;
    } else {
      q += ` AND s.group_pfl_id IS NULL`;
    }

    q += ` ORDER BY s.position`;

    const { rows } = await pool.query(q, params);
    const data = rows.map(row => ({
      club: { id: row.pfl_club_id, title: row.title, titleEn: row.title_en, logo: row.logo },
      points: row.points,
      played: row.played,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
    }));
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
