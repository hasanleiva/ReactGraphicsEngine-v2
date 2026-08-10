# Standings Sync — Design Spec
Date: 2026-08-10

## Goal
Add per-tournament standings sync to the admin panel with interval scheduling and enable/disable toggle. When "Sync Standings" fires (manually or on schedule), standings data is fetched from the PFL API and written to the local PostgreSQL database. The DataMappingModal's Load Data button for standings templates reads from the DB instead of the live PFL API.

## Scope
- New `standings` DB table
- Two new columns on `tournament_sync_configs`
- `syncStandings` function in `pfl-sync.js`
- Standings cron scheduling in `sync-scheduler.js`
- `/api/pfl/standings/:tournamentId` reads from DB
- "Standings" row added to each tournament card in AdminPage
- `DataMappingModal.tsx` — **no changes** (already calls the standings endpoint)

## Database

### New table: `standings`
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
```

Uniqueness is enforced at sync time by DELETE + INSERT (per tournament/season/group combination) rather than a UNIQUE constraint — avoids NULL equality issues with nullable `group_pfl_id`.

### ALTER tournament_sync_configs
```sql
ALTER TABLE tournament_sync_configs
  ADD COLUMN IF NOT EXISTS standings_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS standings_enabled BOOLEAN NOT NULL DEFAULT false;
```

## Backend sync (`server/lib/pfl-sync.js`)

### `syncStandings(tournamentId, seasonId)`
1. Look up `tournament_id` row ID from `tournaments` table.
2. Look up `season_id` row ID from `seasons` table (if provided).
3. Discover all unique `groupId` values from `.pfl.json` configs for this tournament/season where `templateType === 'standings'`. Non-grouped tournaments yield `[null]`.
4. For each unique groupId:
   - Call `pflFetch('/standings/:tournamentId', { seasonId, groupId })`
   - `DELETE FROM standings WHERE tournament_id=… AND season_id IS NOT DISTINCT FROM … AND group_pfl_id IS NOT DISTINCT FROM …`
   - INSERT each entry with position, points, played, goals_for, goals_against, pfl_club_id
5. Return total rows inserted.

### `syncAll` update
Add standings to `syncAll` when scope is `'full'` or `'standings'`:
```
if (scope === 'full' || scope === 'standings') {
  for each pair: await syncStandings(pair.tournamentId, pair.seasonId)
}
```

### Export
Add `syncStandings` to `module.exports`.

## Scheduler (`server/services/sync-scheduler.js`)

### `runSync` — add `'standings'` scope
```js
if (scope === 'standings') result = await syncStandingsForAll(tournamentId, seasonId);
```

### `rebuildTournamentSchedules`
Add standings cron task per config row:
```js
if (cfg.standings_enabled) {
  const expr = minutesToCron(cfg.standings_interval_minutes);
  tasks.standings = cron.schedule(expr, () =>
    runSync('standings', cfg.tournament_id, cfg.season_id)
  );
}
```

## Server routes

### `server/routes/admin.js`
- `PUT /api/admin/tournament-sync-configs/:id` — add `standings_interval_minutes` and `standings_enabled` to the COALESCE update (same pattern as matches/events)
- `POST /api/admin/tournament-sync-configs` — accept `standings_interval_minutes` and `standings_enabled` with defaults
- `POST /api/admin/sync` — already forwards scope to `triggerNow`; no change needed since scheduler handles `'standings'` scope

### `server/routes/pfl.js`
`GET /api/pfl/standings/:tournamentId?seasonId=&groupId=` changes from live-API proxy to DB read:
1. Query `standings` joined with `teams` for logo/title.
2. Filter by `tournament_id`, optionally `season_id`, optionally `group_pfl_id` (IS NULL when not provided).
3. Order by `position`.
4. Map rows to `{ club: { id, title, logo }, points, played, goalsFor, goalsAgainst }` so the modal's field aliases still work.

## Admin UI (`src/pages/AdminPage.tsx`)

### Interface updates
```ts
interface TournamentSyncConfig {
  // existing...
  standings_interval_minutes: number;
  standings_enabled: boolean;
}
interface LocalConfig {
  // existing...
  standings_interval_minutes: number;
  standings_enabled: boolean;
}
```

### Tournament card — add Standings row
Same visual pattern as Matches/Events rows:
- Label: "Standings"
- Interval input bound to `local.standings_interval_minutes`
- Toggle bound to `local.standings_enabled` / calls `handleToggleField(cfg, 'standings_enabled')`
- Button "Sync Standings" → `handleManualSync(cfg, 'standings')`

`handleToggleField` already accepts any field name and sends it to the PUT endpoint — no logic changes needed there.

## Data flow after this change

```
Admin clicks "Sync Standings"
  → POST /api/admin/sync { scope: 'standings', tournamentId, seasonId }
  → sync-scheduler triggerNow('standings', ...)
  → syncStandings discovers groupIds from .pfl.json files
  → PFL API /standings/:id?groupId=...   (one call per group)
  → DELETE old rows + INSERT fresh rows into standings table

User opens DataMappingModal on a STANDINGS template → clicks Load Data
  → GET /api/pfl/standings/:tournamentId?seasonId=&groupId=
  → DB query → rows → shaped response
  → applyStandings maps club IDs to dropdown layers, sets OCHKO/GF/O'YIN text layers
```

## What is NOT changing
- `DataMappingModal.tsx` — zero edits
- Fixtures and fulltime sync flows — unchanged
- Live standings fallback — none; if standings table is empty, Load Data returns empty array. User must sync first.
