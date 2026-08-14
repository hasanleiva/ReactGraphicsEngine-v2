const cron = require('node-cron');
const pool = require('../db/postgres');
const { syncAll } = require('../lib/pfl-sync');

let currentTask = null;
let isSyncing = false;
const tournamentTasks = new Map(); // config.id -> { matches?: CronTask, events?: CronTask }

function minutesToCron(minutes) {
  const m = Math.max(1, Math.floor(minutes));
  if (m < 60) return `*/${m} * * * *`;
  const h = Math.floor(m / 60);
  return `0 */${Math.max(1, h)} * * *`;
}

async function runSync(scope = 'full', tournamentId, seasonId, tourId, tourTitle) {
  if (isSyncing) {
    console.log('[scheduler] Sync already running, skipping');
    return;
  }
  isSyncing = true;

  const tourLabel = tourTitle || tourId;
  const logType = tournamentId ? `${scope}:t${tournamentId}${tourLabel ? `:tour${tourLabel}` : ''}` : scope;
  const logRes = await pool.query(
    "INSERT INTO sync_logs (type, status) VALUES ($1, 'running') RETURNING id",
    [logType]
  );
  const logId = logRes.rows[0].id;

  try {
    const result = await syncAll(tournamentId, seasonId, scope, tourId);
    await pool.query(
      'UPDATE sync_logs SET status=$1, items_synced=$2, completed_at=NOW() WHERE id=$3',
      ['success', result.itemsSynced, logId]
    );
    console.log(`[scheduler] Sync complete (${logType}): ${result.itemsSynced} items`);
  } catch (err) {
    await pool.query(
      'UPDATE sync_logs SET status=$1, message=$2, completed_at=NOW() WHERE id=$3',
      ['error', err.message, logId]
    );
    console.error('[scheduler] Sync failed:', err.message);
  } finally {
    isSyncing = false;
  }
}

async function startScheduler() {
  try {
    const res = await pool.query(
      "SELECT key, value FROM sync_settings WHERE key IN ('sync_interval_minutes', 'sync_enabled')"
    );
    const settings = Object.fromEntries(res.rows.map(r => [r.key, r.value]));
    const minutes = parseInt(settings.sync_interval_minutes || '60', 10);
    const enabled = settings.sync_enabled !== 'false';
    reschedule(minutes, enabled);
    console.log(`[scheduler] Started — interval: ${minutes} min, enabled: ${enabled}`);
    await rebuildTournamentSchedules();
  } catch (err) {
    console.error('[scheduler] Failed to start:', err.message);
  }
}

function reschedule(minutes, enabled = true) {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  if (enabled) {
    const expression = minutesToCron(minutes);
    currentTask = cron.schedule(expression, () => runSync('full'));
    console.log(`[scheduler] Global sync rescheduled — cron: "${expression}"`);
  } else {
    console.log('[scheduler] Global sync disabled');
  }
}

async function rebuildTournamentSchedules() {
  for (const tasks of tournamentTasks.values()) {
    if (tasks.matches) tasks.matches.stop();
    if (tasks.events) tasks.events.stop();
    if (tasks.standings) tasks.standings.stop();
  }
  tournamentTasks.clear();

  try {
    const { rows } = await pool.query('SELECT * FROM tournament_sync_configs');
    for (const cfg of rows) {
      const tasks = {};
      if (cfg.matches_enabled) {
        const expr = minutesToCron(cfg.matches_interval_minutes);
        tasks.matches = cron.schedule(expr, () =>
          runSync('matches', cfg.tournament_id, cfg.season_id).catch(e =>
            console.error(`[scheduler] t${cfg.tournament_id} matches failed:`, e.message)
          )
        );
        console.log(`[scheduler] t${cfg.tournament_id} matches — cron: "${expr}"`);
      }
      if (cfg.events_enabled) {
        const expr = minutesToCron(cfg.events_interval_minutes);
        tasks.events = cron.schedule(expr, () =>
          runSync('events', cfg.tournament_id, cfg.season_id).catch(e =>
            console.error(`[scheduler] t${cfg.tournament_id} events failed:`, e.message)
          )
        );
        console.log(`[scheduler] t${cfg.tournament_id} events — cron: "${expr}"`);
      }
      if (cfg.standings_enabled) {
        const expr = minutesToCron(cfg.standings_interval_minutes);
        tasks.standings = cron.schedule(expr, () =>
          runSync('standings', cfg.tournament_id, cfg.season_id).catch(e =>
            console.error(`[scheduler] t${cfg.tournament_id} standings failed:`, e.message)
          )
        );
        console.log(`[scheduler] t${cfg.tournament_id} standings — cron: "${expr}"`);
      }
      if (tasks.matches || tasks.events || tasks.standings) {
        tournamentTasks.set(cfg.id, tasks);
      }
    }
    console.log(`[scheduler] ${tournamentTasks.size} tournament schedule(s) active`);
  } catch (err) {
    console.error('[scheduler] Failed to rebuild tournament schedules:', err.message);
  }
}

function triggerNow(scope = 'full', tournamentId, seasonId, tourId, tourTitle) {
  return runSync(scope, tournamentId, seasonId, tourId, tourTitle);
}

module.exports = { startScheduler, reschedule, triggerNow, rebuildTournamentSchedules };
