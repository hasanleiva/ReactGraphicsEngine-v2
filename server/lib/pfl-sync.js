const path = require('path');
const fs = require('fs');
const pool = require('../db/postgres');
const { fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents } = require('./pfl-client');

const TEMPLATES_DIR = path.join(__dirname, '../../uploads/templates');

// Read all .pfl.json files and return unique {tournamentId, seasonId} pairs
function discoverTournamentPairs() {
  const pairs = new Map();
  if (!fs.existsSync(TEMPLATES_DIR)) return [];

  for (const folder of fs.readdirSync(TEMPLATES_DIR)) {
    const folderPath = path.join(TEMPLATES_DIR, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    for (const file of fs.readdirSync(folderPath)) {
      if (!file.endsWith('.pfl.json')) continue;
      try {
        const config = JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf8'));
        if (config.tournamentId) {
          const key = `${config.tournamentId}_${config.seasonId || 'null'}`;
          pairs.set(key, { tournamentId: config.tournamentId, seasonId: config.seasonId || null });
        }
      } catch { /* skip malformed */ }
    }
  }
  return [...pairs.values()];
}

async function syncTeams() {
  const clubs = await fetchTeams();
  let count = 0;

  for (const club of clubs) {
    const pflClubId = club.id;
    if (!pflClubId) continue;

    await pool.query(`
      INSERT INTO teams (pfl_club_id, title, title_en, logo, code, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (pfl_club_id) DO UPDATE SET
        title = EXCLUDED.title,
        title_en = EXCLUDED.title_en,
        logo = EXCLUDED.logo,
        code = EXCLUDED.code,
        updated_at = NOW()
    `, [pflClubId, club.title || null, club.titleEn || null, club.logo || null, club.code || null]);
    count++;
  }

  return count;
}

async function syncMatches(tournamentId, seasonId) {
  const apiMatches = await fetchAllMatches(tournamentId, seasonId);
  let count = 0;

  // Upsert tournament row
  await pool.query(`
    INSERT INTO tournaments (pfl_id, title) VALUES ($1, $2)
    ON CONFLICT (pfl_id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
  `, [tournamentId, `Tournament ${tournamentId}`]);
  const tournRes = await pool.query('SELECT id FROM tournaments WHERE pfl_id = $1', [tournamentId]);
  const tournamentRowId = tournRes.rows[0]?.id;

  // Upsert season row if provided
  let seasonRowId = null;
  if (seasonId) {
    await pool.query(`
      INSERT INTO seasons (pfl_id, year) VALUES ($1, $2)
      ON CONFLICT (pfl_id) DO NOTHING
    `, [seasonId, null]);
    const seasRes = await pool.query('SELECT id FROM seasons WHERE pfl_id = $1', [seasonId]);
    seasonRowId = seasRes.rows[0]?.id;
  }

  for (const m of apiMatches) {
    const pflId = m.id;
    if (!pflId) continue;

    // Resolve team IDs from already-synced teams table
    const homeTeamPflId = m.homeClub?.id || m.home_club?.id;
    const awayTeamPflId = m.awayClub?.id || m.away_club?.id;
    const stadiumPflId = m.stadium?.id;

    let homeTeamId = null, awayTeamId = null, stadiumId = null;

    if (homeTeamPflId) {
      const r = await pool.query('SELECT id FROM teams WHERE pfl_club_id = $1', [homeTeamPflId]);
      homeTeamId = r.rows[0]?.id || null;
    }
    if (awayTeamPflId) {
      const r = await pool.query('SELECT id FROM teams WHERE pfl_club_id = $1', [awayTeamPflId]);
      awayTeamId = r.rows[0]?.id || null;
    }
    if (stadiumPflId) {
      await pool.query(`
        INSERT INTO stadiums (pfl_id, title, city) VALUES ($1, $2, $3)
        ON CONFLICT (pfl_id) DO UPDATE SET title = EXCLUDED.title, city = EXCLUDED.city
      `, [stadiumPflId, m.stadium?.title || null, m.stadium?.city || null]);
      const r = await pool.query('SELECT id FROM stadiums WHERE pfl_id = $1', [stadiumPflId]);
      stadiumId = r.rows[0]?.id || null;
    }

    const stagePflId = m.tour?.id || null;
    const stageName = m.tour?.title || null;
    const stageNumber = m.tour?.number || null;
    const startDate = m.startDate || m.start_date || null;
    const homeScore = m.homeScore ?? m.home_score ?? null;
    const awayScore = m.awayScore ?? m.away_score ?? null;
    const status = m.status || 'SCHEDULED';

    await pool.query(`
      INSERT INTO matches (
        pfl_id, tournament_id, season_id,
        home_team_id, away_team_id, stadium_id,
        stage_pfl_id, stage_name, stage_number,
        start_date, home_score, away_score, status, pfl_synced_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
      ON CONFLICT (pfl_id) DO UPDATE SET
        tournament_id = EXCLUDED.tournament_id,
        season_id = EXCLUDED.season_id,
        home_team_id = EXCLUDED.home_team_id,
        away_team_id = EXCLUDED.away_team_id,
        stadium_id = EXCLUDED.stadium_id,
        stage_pfl_id = EXCLUDED.stage_pfl_id,
        stage_name = EXCLUDED.stage_name,
        stage_number = EXCLUDED.stage_number,
        start_date = EXCLUDED.start_date,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        status = EXCLUDED.status,
        pfl_synced_at = NOW(),
        updated_at = NOW()
    `, [
      pflId, tournamentRowId, seasonRowId,
      homeTeamId, awayTeamId, stadiumId,
      stagePflId, stageName, stageNumber,
      startDate, homeScore, awayScore, status
    ]);
    count++;
  }

  return count;
}

async function syncMatchEvents(matchPflId) {
  // Get our internal match ID
  const matchRes = await pool.query('SELECT id, home_team_id, away_team_id FROM matches WHERE pfl_id = $1', [matchPflId]);
  if (!matchRes.rows[0]) return 0;
  const match = matchRes.rows[0];

  const events = await fetchMatchEvents(matchPflId);
  if (!Array.isArray(events) || events.length === 0) return 0;

  // Count goals per club
  const goalsByClub = {};
  for (const ev of events) {
    if (ev.type === 1 && ev.club?.id) {
      goalsByClub[ev.club.id] = (goalsByClub[ev.club.id] || 0) + 1;
    }
  }

  // Get home/away team pfl_club_ids
  let homeScore = null, awayScore = null;
  if (match.home_team_id) {
    const r = await pool.query('SELECT pfl_club_id FROM teams WHERE id = $1', [match.home_team_id]);
    if (r.rows[0]) homeScore = goalsByClub[r.rows[0].pfl_club_id] ?? 0;
  }
  if (match.away_team_id) {
    const r = await pool.query('SELECT pfl_club_id FROM teams WHERE id = $1', [match.away_team_id]);
    if (r.rows[0]) awayScore = goalsByClub[r.rows[0].pfl_club_id] ?? 0;
  }

  // Update scores
  if (homeScore !== null || awayScore !== null) {
    await pool.query(
      'UPDATE matches SET home_score = $1, away_score = $2, updated_at = NOW() WHERE id = $3',
      [homeScore, awayScore, match.id]
    );
  }

  // Upsert cards
  const CARD_TYPE_MAP = { 2: 'YELLOW', 4: 'YELLOW', 3: 'RED', 5: 'RED', 7: 'RED' };
  let cardCount = 0;

  for (const ev of events) {
    const cardType = CARD_TYPE_MAP[ev.type];
    if (!cardType || !ev.id) continue;

    // Upsert player
    let playerRowId = null;
    if (ev.player?.id) {
      await pool.query(`
        INSERT INTO players (pfl_player_id, first_name, last_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (pfl_player_id) DO NOTHING
      `, [ev.player.id, ev.player.firstName || ev.player.first_name || null, ev.player.lastName || ev.player.last_name || null]);
      const pr = await pool.query('SELECT id FROM players WHERE pfl_player_id = $1', [ev.player.id]);
      playerRowId = pr.rows[0]?.id || null;
    }

    // Resolve team
    let teamRowId = null;
    if (ev.club?.id) {
      const tr = await pool.query('SELECT id FROM teams WHERE pfl_club_id = $1', [ev.club.id]);
      teamRowId = tr.rows[0]?.id || null;
    }

    await pool.query(`
      INSERT INTO player_match_cards (pfl_event_id, match_id, player_id, team_id, card_type, minute, extra_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (pfl_event_id) DO UPDATE SET
        card_type = EXCLUDED.card_type,
        minute = EXCLUDED.minute,
        extra_time = EXCLUDED.extra_time
    `, [ev.id, match.id, playerRowId, teamRowId, cardType, ev.minute || null, ev.extraTime || ev.extra_time || null]);
    cardCount++;
  }

  return cardCount;
}

async function syncReferees(matchPflId) {
  const matchDetail = await fetchMatch(matchPflId);
  const refList = matchDetail.referees || (matchDetail.referee ? [matchDetail.referee] : []);
  if (refList.length === 0) return 0;

  const matchRes = await pool.query('SELECT id FROM matches WHERE pfl_id = $1', [matchPflId]);
  if (!matchRes.rows[0]) return 0;
  const matchRowId = matchRes.rows[0].id;

  let count = 0;
  for (const ref of refList) {
    if (!ref?.id) continue;

    await pool.query(`
      INSERT INTO referees (pfl_id, first_name, last_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (pfl_id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
    `, [ref.id, ref.firstName || ref.first_name || null, ref.lastName || ref.last_name || null]);

    const refRes = await pool.query('SELECT id FROM referees WHERE pfl_id = $1', [ref.id]);
    const refereeRowId = refRes.rows[0]?.id;
    const role = ref.role || 'MAIN';

    await pool.query(`
      INSERT INTO match_referees (match_id, referee_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (match_id, role) DO UPDATE SET referee_id = EXCLUDED.referee_id
    `, [matchRowId, refereeRowId, role]);
    count++;
  }
  return count;
}

async function syncAll(tournamentId, seasonId) {
  // If no explicit tournament, discover from .pfl.json files
  const pairs = (tournamentId != null)
    ? [{ tournamentId, seasonId }]
    : discoverTournamentPairs();

  if (pairs.length === 0) {
    console.log('[sync] No tournament pairs found — add .pfl.json files to uploads/templates/*');
    return { itemsSynced: 0 };
  }

  let totalMatches = 0;

  const teamCount = await syncTeams();
  console.log(`[sync] Teams: ${teamCount}`);

  for (const pair of pairs) {
    const matchCount = await syncMatches(pair.tournamentId, pair.seasonId);
    totalMatches += matchCount;
    console.log(`[sync] Matches (tournament ${pair.tournamentId}): ${matchCount}`);

    // Sync events for all matches in this tournament
    const matchRows = await pool.query(
      'SELECT pfl_id FROM matches WHERE tournament_id = (SELECT id FROM tournaments WHERE pfl_id = $1)',
      [pair.tournamentId]
    );
    for (const row of matchRows.rows) {
      try {
        await syncMatchEvents(row.pfl_id);
        await new Promise(r => setTimeout(r, 130));
      } catch (e) {
        console.warn(`[sync] Events failed for match ${row.pfl_id}: ${e.message}`);
      }
    }

    // Sync referees for all matches
    for (const row of matchRows.rows) {
      try {
        await syncReferees(row.pfl_id);
        await new Promise(r => setTimeout(r, 130));
      } catch (e) {
        console.warn(`[sync] Referees failed for match ${row.pfl_id}: ${e.message}`);
      }
    }
  }

  return { itemsSynced: totalMatches };
}

module.exports = { syncTeams, syncMatches, syncMatchEvents, syncReferees, syncAll, discoverTournamentPairs };
