const express = require('express');
const router = express.Router();
const pool = require('../db/postgres');

// GET /api/mc/teams
router.get('/teams', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, pfl_club_id, title, title_en, logo, code FROM teams ORDER BY title'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mc/tours?tournamentId=&seasonId=
router.get('/tours', async (req, res) => {
  try {
    const { tournamentId, seasonId } = req.query;
    const conditions = [];
    const params = [];

    if (tournamentId) {
      params.push(Number(tournamentId));
      conditions.push(`m.tournament_id = (SELECT id FROM tournaments WHERE pfl_id = $${params.length})`);
    }
    if (seasonId) {
      params.push(Number(seasonId));
      conditions.push(`m.season_id = (SELECT id FROM seasons WHERE pfl_id = $${params.length})`);
    }

    conditions.push('m.stage_pfl_id IS NOT NULL');
    const where = 'WHERE ' + conditions.join(' AND ');
    const { rows } = await pool.query(`
      SELECT DISTINCT m.stage_pfl_id AS id, m.stage_name AS title, m.stage_number AS number
      FROM matches m
      ${where}
      ORDER BY m.stage_number ASC
    `, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mc/matches?tournamentId=&seasonId=&tourId=&page=&limit=
router.get('/matches', async (req, res) => {
  try {
    const { tournamentId, seasonId, tourId } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (tournamentId) {
      params.push(Number(tournamentId));
      conditions.push(`m.tournament_id = (SELECT id FROM tournaments WHERE pfl_id = $${params.length})`);
    }
    if (seasonId) {
      params.push(Number(seasonId));
      conditions.push(`m.season_id = (SELECT id FROM seasons WHERE pfl_id = $${params.length})`);
    }
    if (tourId) {
      params.push(Number(tourId));
      conditions.push(`m.stage_pfl_id = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM matches m ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT
        m.id, m.pfl_id, m.start_date, m.home_score, m.away_score, m.status,
        m.stage_pfl_id, m.stage_name, m.stage_number,
        ht.title AS home_team_title, ht.pfl_club_id AS home_team_pfl_id, ht.logo AS home_team_logo,
        at.title AS away_team_title, at.pfl_club_id AS away_team_pfl_id, at.logo AS away_team_logo
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      ${where}
      ORDER BY m.start_date ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mc/matches/:id
router.get('/matches/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.id, m.pfl_id, m.start_date, m.home_score, m.away_score, m.status,
        m.stage_pfl_id, m.stage_name, m.stage_number,
        ht.id AS home_team_id, ht.title AS home_team_title, ht.pfl_club_id AS home_team_pfl_id, ht.logo AS home_team_logo,
        at.id AS away_team_id, at.title AS away_team_title, at.pfl_club_id AS away_team_pfl_id, at.logo AS away_team_logo,
        s.title AS stadium_title
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      LEFT JOIN stadiums s ON s.id = m.stadium_id
      WHERE m.pfl_id = $1
    `, [Number(req.params.id)]);

    if (!rows[0]) return res.status(404).json({ error: 'Match not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mc/sync/status
router.get('/sync/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 1'
    );
    res.json(rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
