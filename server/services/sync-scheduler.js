const cron = require('node-cron');
const pool = require('../db/postgres');
const { syncAll } = require('../lib/pfl-sync');

let currentTask = null;
let isSyncing = false;

function minutesToCron(minutes) {
  const m = Math.max(1, Math.floor(minutes));
  if (m < 60) return `*/${m} * * * *`;
  const h = Math.floor(m / 60);
  return `0 */${Math.max(1, h)} * * *`;
}

async function runSync(scope = 'full', tournamentId, seasonId) {
  if (isSyncing) {
    console.log('[scheduler] Sync already running, skipping');
    return;
  }
  isSyncing = true;

  const logRes = await pool.query(
    "INSERT INTO sync_logs (type, status) VALUES ($1, 'running') RETURNING id",
    [scope]
  );
  const logId = logRes.rows[0].id;

  try {
    const result = await syncAll(tournamentId, seasonId);
    await pool.query(
      'UPDATE sync_logs SET status=$1, items_synced=$2, completed_at=NOW() WHERE id=$3',
      ['success', result.itemsSynced, logId]
    );
    console.log(`[scheduler] Sync complete: ${result.itemsSynced} items`);
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
    const res = await pool.query("SELECT value FROM sync_settings WHERE key = 'sync_interval_minutes'");
    const minutes = parseInt(res.rows[0]?.value || '60', 10);
    reschedule(minutes);
    console.log(`[scheduler] Started — interval: ${minutes} min`);
  } catch (err) {
    console.error('[scheduler] Failed to start:', err.message);
  }
}

function reschedule(minutes) {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  const expression = minutesToCron(minutes);
  currentTask = cron.schedule(expression, () => runSync('full'));
  console.log(`[scheduler] Rescheduled — cron: "${expression}"`);
}

function triggerNow(scope = 'full', tournamentId, seasonId) {
  return runSync(scope, tournamentId, seasonId);
}

module.exports = { startScheduler, reschedule, triggerNow };
