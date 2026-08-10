# Standings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tournament standings sync to the admin panel — writes PFL API standings to PostgreSQL, DataMappingModal reads from DB.

**Architecture:** New `standings` DB table stores position/points/goals per club per group. `syncStandings()` in pfl-sync.js discovers groupIds from existing `.pfl.json` configs and calls the PFL API once per group. The existing `/api/pfl/standings/:id` route is switched from live-API proxy to DB query. AdminPage gets a third row (Standings) inside each tournament card — same interval+toggle+button pattern as Matches and Events.

**Tech Stack:** PostgreSQL (pg pool), Express.js, React + inline styles (no CSS framework), node-cron

---

## File Map

| File | Change |
|---|---|
| `server/db/schema.sql` | Add `standings` table; ALTER `tournament_sync_configs` |
| `server/lib/pfl-sync.js` | Add `discoverGroupsForStandings`, `syncStandings`; update `syncAll`; update imports |
| `server/services/sync-scheduler.js` | Add standings cron task in `rebuildTournamentSchedules`; stop standings tasks on rebuild |
| `server/routes/admin.js` | Add `standings_*` fields to POST and PUT tournament-sync-configs |
| `server/routes/pfl.js` | Import `pool`; replace live-API standings proxy with DB query |
| `src/pages/AdminPage.tsx` | Extend interfaces; add Standings row to tournament card; update `handleToggleField` type |

---

## Task 1: Database — standings table + new columns

**Files:**
- Modify: `server/db/schema.sql`

- [ ] **Step 1: Add standings table and ALTER to schema.sql**

Append to the end of `server/db/schema.sql` (before or after the existing migration lines):

```sql
-- Standings data (synced from PFL API)
CREATE TABLE IF NOT EXISTS standings (
  id              SERIAL PRIMARY KEY,
  tournament_id   INTEGER REFERENCES tournaments(id),
  season_id       INTEGER REFERENCES seasons(id),
  group_pfl_id    INTEGER,
  pfl_club_id     INTEGER NOT NULL,
  position        INTEGER,
  points          INTEGER,
  played          INTEGER,
  goals_for       INTEGER,
  goals_against   INTEGER,
  pfl_synced_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Migrations for existing databases
ALTER TABLE tournament_sync_configs
  ADD COLUMN IF NOT EXISTS standings_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS standings_enabled BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Run the SQL in pgAdmin**

Open pgAdmin → right-click `pfl_app` → Query Tool. Run:

```sql
CREATE TABLE IF NOT EXISTS standings (
  id              SERIAL PRIMARY KEY,
  tournament_id   INTEGER REFERENCES tournaments(id),
  season_id       INTEGER REFERENCES seasons(id),
  group_pfl_id    INTEGER,
  pfl_club_id     INTEGER NOT NULL,
  position        INTEGER,
  points          INTEGER,
  played          INTEGER,
  goals_for       INTEGER,
  goals_against   INTEGER,
  pfl_synced_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tournament_sync_configs
  ADD COLUMN IF NOT EXISTS standings_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS standings_enabled BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Verify**

Run in pgAdmin:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'tournament_sync_configs'
ORDER BY ordinal_position;
```
Expected: `standings_interval_minutes` and `standings_enabled` appear in results.

```sql
SELECT COUNT(*) FROM standings;
```
Expected: `0` (table exists, no rows yet).

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.sql
git commit -m "feat: add standings table and standings columns to tournament_sync_configs"
```

---

## Task 2: syncStandings in pfl-sync.js

**Files:**
- Modify: `server/lib/pfl-sync.js`

- [ ] **Step 1: Add `pflFetch` to the import on line 4**

Change the destructure from:
```js
const { fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents } = require('./pfl-client');
```
to:
```js
const { pflFetch, fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents } = require('./pfl-client');
```

- [ ] **Step 2: Add `discoverGroupsForStandings` helper after `discoverTournamentPairs`**

Insert this function after the closing brace of `discoverTournamentPairs` (around line 29):

```js
// Returns unique groupId values (including null) from standings .pfl.json configs for this tournament.
function discoverGroupsForStandings(tournamentId, seasonId) {
  const groups = new Set();
  if (!fs.existsSync(TEMPLATES_DIR)) return [null];

  for (const folder of fs.readdirSync(TEMPLATES_DIR)) {
    const folderPath = path.join(TEMPLATES_DIR, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    for (const file of fs.readdirSync(folderPath)) {
      if (!file.endsWith('.pfl.json')) continue;
      try {
        const config = JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf8'));
        if (config.tournamentId !== tournamentId) continue;
        if (seasonId != null && config.seasonId != null && config.seasonId !== seasonId) continue;
        if (config.templateType !== 'standings') continue;
        groups.add(config.groupId || null);
      } catch { /* skip malformed */ }
    }
  }
  return groups.size > 0 ? [...groups] : [null];
}
```

- [ ] **Step 3: Add `syncStandings` function before `module.exports`**

Insert this function before the `module.exports` line at the end of the file:

```js
async function syncStandings(tournamentId, seasonId) {
  // Ensure tournament row exists
  await pool.query(`
    INSERT INTO tournaments (pfl_id, title) VALUES ($1, $2)
    ON CONFLICT (pfl_id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
  `, [tournamentId, `Tournament ${tournamentId}`]);
  const tournRes = await pool.query('SELECT id FROM tournaments WHERE pfl_id = $1', [tournamentId]);
  const tournamentRowId = tournRes.rows[0]?.id;

  let seasonRowId = null;
  if (seasonId) {
    await pool.query(`
      INSERT INTO seasons (pfl_id, year) VALUES ($1, $2) ON CONFLICT (pfl_id) DO NOTHING
    `, [seasonId, null]);
    const seasRes = await pool.query('SELECT id FROM seasons WHERE pfl_id = $1', [seasonId]);
    seasonRowId = seasRes.rows[0]?.id;
  }

  const groupIds = discoverGroupsForStandings(tournamentId, seasonId);
  let totalCount = 0;

  for (const groupId of groupIds) {
    const query = {};
    if (seasonId) query.seasonId = seasonId;
    if (groupId) query.groupId = groupId;

    let raw;
    try {
      raw = await pflFetch(`/standings/${tournamentId}`, query);
    } catch (e) {
      console.warn(`[sync] Standings fetch failed for t${tournamentId} group ${groupId}: ${e.message}`);
      continue;
    }

    const entries = Array.isArray(raw) ? raw : (raw?.data || raw?.standings || []);

    // Replace all rows for this tournament/season/group
    await pool.query(
      'DELETE FROM standings WHERE tournament_id = $1 AND season_id IS NOT DISTINCT FROM $2 AND group_pfl_id IS NOT DISTINCT FROM $3',
      [tournamentRowId, seasonRowId, groupId || null]
    );

    let count = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const clubId = entry.club?.id ?? entry.team?.id ?? entry.clubId ?? entry.teamId;
      if (!clubId) continue;

      const pts = entry.points ?? entry.pts ?? entry.point ?? null;
      const gf = entry.goalsFor ?? entry.gf ?? entry.scored ?? entry.goals_for ?? null;
      const ga = entry.goalsAgainst ?? entry.ga ?? entry.conceded ?? entry.goals_against ?? null;
      const gp = entry.played ?? entry.gp ?? entry.matchesPlayed ?? entry.games ?? null;

      await pool.query(`
        INSERT INTO standings
          (tournament_id, season_id, group_pfl_id, pfl_club_id, position, points, played, goals_for, goals_against)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [tournamentRowId, seasonRowId, groupId || null, clubId, i + 1, pts, gp, gf, ga]);
      count++;
    }

    console.log(`[sync] Standings: t${tournamentId} group ${groupId || 'none'} → ${count} rows`);
    totalCount += count;
  }

  return totalCount;
}
```

- [ ] **Step 4: Add 'standings' scope to `syncAll`**

In the `syncAll` function, add standings handling after the events/referees block (before `return { itemsSynced: totalItems }`):

```js
  if (scope === 'full' || scope === 'standings') {
    for (const pair of pairs) {
      const standingsCount = await syncStandings(pair.tournamentId, pair.seasonId);
      totalItems += standingsCount;
      console.log(`[sync] Standings (tournament ${pair.tournamentId}): ${standingsCount}`);
    }
  }
```

- [ ] **Step 5: Export `syncStandings`**

Change the `module.exports` line at the bottom of the file from:
```js
module.exports = { syncTeams, syncMatches, syncMatchEvents, syncReferees, syncAll, discoverTournamentPairs };
```
to:
```js
module.exports = { syncTeams, syncMatches, syncMatchEvents, syncReferees, syncAll, syncStandings, discoverTournamentPairs };
```

- [ ] **Step 6: Verify the server still starts**

```bash
node -e "require('./server/lib/pfl-sync')"
```
Expected: no output, no error (module loads cleanly).

- [ ] **Step 7: Commit**

```bash
git add server/lib/pfl-sync.js
git commit -m "feat: add syncStandings — fetches PFL standings per group, writes to DB"
```

---

## Task 3: Standings scheduling in sync-scheduler.js

**Files:**
- Modify: `server/services/sync-scheduler.js`

- [ ] **Step 1: Add standings cron task to `rebuildTournamentSchedules`**

Inside `rebuildTournamentSchedules`, after the existing `if (cfg.events_enabled)` block, add:

```js
      if (cfg.standings_enabled) {
        const expr = minutesToCron(cfg.standings_interval_minutes);
        tasks.standings = cron.schedule(expr, () =>
          runSync('standings', cfg.tournament_id, cfg.season_id).catch(e =>
            console.error(`[scheduler] t${cfg.tournament_id} standings failed:`, e.message)
          )
        );
        console.log(`[scheduler] t${cfg.tournament_id} standings — cron: "${expr}"`);
      }
```

- [ ] **Step 2: Stop standings tasks on rebuild**

In the cleanup loop at the top of `rebuildTournamentSchedules`:
```js
  for (const tasks of tournamentTasks.values()) {
    if (tasks.matches) tasks.matches.stop();
    if (tasks.events) tasks.events.stop();
    if (tasks.standings) tasks.standings.stop();
  }
```

- [ ] **Step 3: Fix the `tournamentTasks.set` guard to include standings**

Change:
```js
      if (tasks.matches || tasks.events) {
        tournamentTasks.set(cfg.id, tasks);
      }
```
to:
```js
      if (tasks.matches || tasks.events || tasks.standings) {
        tournamentTasks.set(cfg.id, tasks);
      }
```

- [ ] **Step 4: Verify module loads cleanly**

```bash
node -e "require('./server/services/sync-scheduler')"
```
Expected: no error.

- [ ] **Step 5: Commit**

```bash
git add server/services/sync-scheduler.js
git commit -m "feat: add standings cron scheduling per tournament"
```

---

## Task 4: Admin route — standings fields in tournament config CRUD

**Files:**
- Modify: `server/routes/admin.js`

- [ ] **Step 1: Update POST /api/admin/tournament-sync-configs**

Replace the destructure and INSERT query in the POST handler:

```js
    const {
      tournament_id, season_id,
      matches_interval_minutes = 60, matches_enabled = false,
      events_interval_minutes = 60, events_enabled = false,
      standings_interval_minutes = 60, standings_enabled = false,
    } = req.body;
    if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required' });

    const { rows } = await pool.query(`
      INSERT INTO tournament_sync_configs
        (tournament_id, season_id,
         matches_interval_minutes, matches_enabled,
         events_interval_minutes, events_enabled,
         standings_interval_minutes, standings_enabled,
         updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, [
      Number(tournament_id), season_id ? Number(season_id) : null,
      Number(matches_interval_minutes), Boolean(matches_enabled),
      Number(events_interval_minutes), Boolean(events_enabled),
      Number(standings_interval_minutes), Boolean(standings_enabled),
    ]);
```

- [ ] **Step 2: Update PUT /api/admin/tournament-sync-configs/:id**

Replace the destructure and UPDATE query in the PUT handler:

```js
    const {
      matches_interval_minutes, matches_enabled,
      events_interval_minutes, events_enabled,
      standings_interval_minutes, standings_enabled,
    } = req.body;
    const { rows } = await pool.query(`
      UPDATE tournament_sync_configs SET
        matches_interval_minutes   = COALESCE($1, matches_interval_minutes),
        matches_enabled            = COALESCE($2, matches_enabled),
        events_interval_minutes    = COALESCE($3, events_interval_minutes),
        events_enabled             = COALESCE($4, events_enabled),
        standings_interval_minutes = COALESCE($5, standings_interval_minutes),
        standings_enabled          = COALESCE($6, standings_enabled),
        updated_at = NOW()
      WHERE id = $7 RETURNING *
    `, [
      matches_interval_minutes != null ? Number(matches_interval_minutes) : null,
      matches_enabled != null ? Boolean(matches_enabled) : null,
      events_interval_minutes != null ? Number(events_interval_minutes) : null,
      events_enabled != null ? Boolean(events_enabled) : null,
      standings_interval_minutes != null ? Number(standings_interval_minutes) : null,
      standings_enabled != null ? Boolean(standings_enabled) : null,
      Number(req.params.id),
    ]);
```

- [ ] **Step 3: Verify**

Restart the Express server. In a terminal (or curl):
```bash
curl -s http://localhost:3000/api/admin/tournament-sync-configs \
  -H "Cookie: <your-session-cookie>"
```
Expected: JSON array with `standings_interval_minutes` and `standings_enabled` fields on each entry.

- [ ] **Step 4: Commit**

```bash
git add server/routes/admin.js
git commit -m "feat: expose standings_interval_minutes and standings_enabled in tournament-sync-configs CRUD"
```

---

## Task 5: Standings endpoint reads from DB

**Files:**
- Modify: `server/routes/pfl.js`

- [ ] **Step 1: Add `pool` import at the top of pfl.js**

After the existing imports, add:
```js
const pool = require('../db/postgres');
```

The top of the file should now read:
```js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { pflFetch } = require('../lib/pfl-client');
const { requireAdmin } = require('../middleware/auth');
const pool = require('../db/postgres');
```

- [ ] **Step 2: Replace the standings route**

Find and replace the entire `GET /api/pfl/standings/:tournamentId` handler (currently lines ~76-87):

```js
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
```

- [ ] **Step 3: Verify**

With the Express server running, manually trigger a standings sync for one tournament (use the admin panel Sync Standings button added in Task 6, or call directly):

```bash
node -e "
const { syncStandings } = require('./server/lib/pfl-sync');
require('dotenv').config();
syncStandings(1, 11).then(n => console.log('rows:', n)).catch(console.error);
"
```

Then verify the endpoint returns data:
```bash
curl "http://localhost:3000/api/pfl/standings/1?seasonId=11"
```
Expected: JSON array with `club.id`, `points`, `played`, `goalsFor`, `goalsAgainst` fields.

- [ ] **Step 4: Commit**

```bash
git add server/routes/pfl.js
git commit -m "feat: standings endpoint reads from DB instead of live PFL API"
```

---

## Task 6: AdminPage.tsx — standings row in tournament card

**Files:**
- Modify: `src/pages/AdminPage.tsx`

- [ ] **Step 1: Extend `TournamentSyncConfig` interface**

Replace:
```ts
interface TournamentSyncConfig {
  id: number;
  tournament_id: number;
  season_id: number | null;
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
}
```
with:
```ts
interface TournamentSyncConfig {
  id: number;
  tournament_id: number;
  season_id: number | null;
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
  standings_interval_minutes: number;
  standings_enabled: boolean;
}
```

- [ ] **Step 2: Extend `LocalConfig` interface**

Replace:
```ts
interface LocalConfig {
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
}
```
with:
```ts
interface LocalConfig {
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
  standings_interval_minutes: number;
  standings_enabled: boolean;
}
```

- [ ] **Step 3: Include standings fields in `loadTournamentConfigs`**

In `loadTournamentConfigs`, update the local state init block:
```ts
        local[c.id] = {
          matches_interval_minutes: c.matches_interval_minutes,
          matches_enabled: c.matches_enabled,
          events_interval_minutes: c.events_interval_minutes,
          events_enabled: c.events_enabled,
          standings_interval_minutes: c.standings_interval_minutes,
          standings_enabled: c.standings_enabled,
        };
```

- [ ] **Step 4: Update `handleToggleField` type signature**

Change:
```ts
  const handleToggleField = async (cfg: TournamentSyncConfig, field: 'matches_enabled' | 'events_enabled') => {
```
to:
```ts
  const handleToggleField = async (cfg: TournamentSyncConfig, field: 'matches_enabled' | 'events_enabled' | 'standings_enabled') => {
```

- [ ] **Step 5: Update `handleManualSync` type signature**

Change:
```ts
  const handleManualSync = async (cfg: TournamentSyncConfig, scope: 'matches' | 'events') => {
```
to:
```ts
  const handleManualSync = async (cfg: TournamentSyncConfig, scope: 'matches' | 'events' | 'standings') => {
```

- [ ] **Step 6: Add Standings row in the tournament card JSX**

Inside the `tConfigs.map(cfg => ...)` render, after the closing `</div>` of the Events row and before the Save Intervals button `<div>`, insert:

```tsx
                    {/* Standings row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#374151', width: 60, flexShrink: 0 }}>Standings</span>
                      <span style={{ fontSize: 13, color: '#6b7280' }}>every</span>
                      <input
                        type="number" min={1}
                        style={{ ...s.input, maxWidth: 70, padding: '5px 8px' }}
                        value={local.standings_interval_minutes}
                        onChange={e => patchLocal(cfg.id, { standings_interval_minutes: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
                      <Toggle enabled={local.standings_enabled} onChange={() => handleToggleField(cfg, 'standings_enabled')} />
                      <span style={{ fontSize: 12, color: local.standings_enabled ? '#059669' : '#9ca3af', fontWeight: 600 }}>
                        {local.standings_enabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        style={s.smBtn(syncingId[`${cfg.id}_standings`] ? '#9ca3af' : '#f59e0b')}
                        disabled={!!syncingId[`${cfg.id}_standings`]}
                        onClick={() => handleManualSync(cfg, 'standings')}
                      >
                        {syncingId[`${cfg.id}_standings`] ? '…' : 'Sync Standings'}
                      </button>
                    </div>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Start dev server and verify visually**

Start the app, go to Admin → Sync Control. Each tournament card should now show three rows: Matches, Events, Standings — with identical layout. Clicking "Sync Standings" should show the button disable briefly and a sync log entry should appear.

- [ ] **Step 9: Commit**

```bash
git add src/pages/AdminPage.tsx
git commit -m "feat: add standings sync row to tournament cards in admin panel"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Sync standings for one tournament**

In Admin → Sync Control, find tournament 1 (or whichever has standings configured), click "Sync Standings". Watch the server console for:
```
[sync] Standings: t1 group none → 16 rows
[sync] Standings (tournament 1): 16
```

- [ ] **Step 2: Verify data in DB**

pgAdmin Query Tool on `pfl_app`:
```sql
SELECT t.title, s.position, s.points, s.played, s.goals_for, s.goals_against
FROM standings s
LEFT JOIN teams t ON t.pfl_club_id = s.pfl_club_id
WHERE s.tournament_id = (SELECT id FROM tournaments WHERE pfl_id = 1)
ORDER BY s.position;
```
Expected: rows with team names, points, goals.

- [ ] **Step 3: Verify LoadData in DataMappingModal**

Open a STANDINGS template in the editor → click "Data Mapping" → click "Load Data". Verify:
- `Team1`, `Team2`, … dropdown layers update with correct team logos
- `1-OCHKO`, `2-OCHKO`, … update with points
- `1-GF`, `2-GF`, … update with `goalsFor-goalsAgainst` format (e.g. `25-10`)
- `1-O'YIN`, `2-O'YIN`, … update with games played

- [ ] **Step 4: Verify grouped tournament (1-LIGA)**

If 1-LIGA is configured, sync it and check:
```sql
SELECT group_pfl_id, COUNT(*) FROM standings
WHERE tournament_id = (SELECT id FROM tournaments WHERE pfl_id = 3)
GROUP BY group_pfl_id;
```
Expected: three rows, one per group (9=SHARQ, 10=GARB, 11=MARKAZ) with team counts.

Open `1-LIGA/STANDINGS (GARB)` template → Load Data → verify only GARB teams populate.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat: standings sync complete — DB-backed standings in admin and DataMappingModal"
```
