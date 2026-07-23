# Match Controller + PostgreSQL Integration — Design Spec

**Date:** 2026-07-23  
**Status:** Approved

---

## Overview

Replace the SQLite database with PostgreSQL for all data (users, sessions, PFL match data). Add a PFL sync service that periodically fetches and upserts data from `https://api.pfl.uz/public/v1`. Expose Match Controller endpoints so the frontend can query its own database instead of the external PFL API directly. Add an admin-only page for managing template configs and controlling the sync service.

---

## 1. Database Layer

### Connection

- **Package:** `pg` (node-postgres)
- **Config:** `DATABASE_URL` environment variable (e.g. `postgresql://user:pass@localhost:5432/pfl_app`)
- **File:** `server/db/postgres.js` — exports a `Pool` singleton
- **Migration:** `server/db/migrate.js` — reads `server/db/schema.sql` and runs it on server startup (all statements are `CREATE TABLE IF NOT EXISTS`, safe to re-run)
- `server/db.js` is removed; all imports are updated to `server/db/postgres.js`

### Schema

All tables live in the default `public` schema.

#### Auth tables (migrated from SQLite)

```sql
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
```

#### PFL data tables

```sql
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  pfl_id INTEGER UNIQUE NOT NULL,
  title TEXT,
  title_en TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  pfl_id INTEGER UNIQUE NOT NULL,
  year INTEGER,
  is_active BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  pfl_club_id INTEGER UNIQUE NOT NULL,
  title TEXT,
  title_en TEXT,
  logo TEXT,
  code VARCHAR(20),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stadiums (
  id SERIAL PRIMARY KEY,
  pfl_id INTEGER UNIQUE NOT NULL,
  title TEXT,
  city TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  pfl_id INTEGER UNIQUE NOT NULL,
  tournament_id INTEGER REFERENCES tournaments(id),
  season_id INTEGER REFERENCES seasons(id),
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  stadium_id INTEGER REFERENCES stadiums(id),
  stage_pfl_id INTEGER,
  stage_name TEXT,
  stage_number INTEGER,
  start_date TIMESTAMPTZ,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT DEFAULT 'SCHEDULED',
  pfl_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referees (
  id SERIAL PRIMARY KEY,
  pfl_id INTEGER UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT
);

CREATE TABLE IF NOT EXISTS match_referees (
  id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  referee_id INTEGER REFERENCES referees(id),
  role TEXT NOT NULL,
  UNIQUE(match_id, role)
);

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  pfl_player_id INTEGER UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT
);

CREATE TABLE IF NOT EXISTS player_match_cards (
  id SERIAL PRIMARY KEY,
  pfl_event_id INTEGER UNIQUE NOT NULL,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  card_type TEXT,
  minute INTEGER,
  extra_time INTEGER,
  source TEXT DEFAULT 'PFL_SYNC',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Sync infrastructure

```sql
CREATE TABLE IF NOT EXISTS sync_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  items_synced INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

Default sync setting inserted on first run: `key='sync_interval_minutes', value='60'`.

---

## 2. Auth Migration

`server/routes/auth.js` and `server/middleware/auth.js` are rewritten to use `pg` pool with `await pool.query()`. All logic is identical to the current SQLite version; only the DB calls change from synchronous `.prepare().get()` / `.run()` to async `pool.query(sql, params)`.

The local `requireAdmin` copy inside `server/routes/pfl.js` is removed and replaced with the imported one from `server/middleware/auth.js`.

---

## 3. PFL Sync Service

### PFL Client (`server/lib/pfl-client.js`)

Wraps `fetch` with `PFL_API_KEY` header. Provides:

- `pflFetch(endpoint, queryParams)` — single request
- `fetchAllPages(endpoint, params)` — loops pages, 130ms pause between each (rate limit)
- `fetchTeams()` — `/clubs`
- `fetchAllMatches(tournamentId, seasonId)` — all pages of `/matches`
- `fetchMatch(id)` — `/matches/:id` (includes referees in response)
- `fetchMatchEvents(id)` — `/matches/:id/events`

### Sync Service (`server/lib/pfl-sync.js`)

All functions are idempotent via `ON CONFLICT ... DO UPDATE`.

- `syncTeams()` — upserts all clubs into `teams`
- `syncMatches(tournamentId, seasonId)` — upserts all matches for a tournament/season; resolves `home_team_id`/`away_team_id`/`stadium_id` from already-synced teams/stadiums
- `syncMatchEvents(matchPflId)` — fetches events for one match:
  - type 1 (goal): counts per club, updates `home_score`/`away_score` on the match row
  - type 2/4 (yellow card) → `card_type = 'YELLOW'`
  - type 3/5/7 (red card) → `card_type = 'RED'`
  - Upserts into `player_match_cards` keyed on `pfl_event_id`
- `syncReferees(matchPflId)` — fetches match detail, upserts referees, upserts `match_referees` rows keyed on `(match_id, role)`
- `syncAll(tournamentId, seasonId)` — runs teams → matches → events → referees in order; writes a `sync_logs` row with status and count

### Scheduler (`server/services/sync-scheduler.js`)

- Reads `sync_interval_minutes` from `sync_settings` on startup
- Schedules a `node-cron` job accordingly
- Exposes `reschedule(minutes)` — cancels current job and creates a new one
- Exposes `triggerNow(scope)` — runs sync immediately outside the cron cycle

---

## 4. Match Controller (`server/routes/match-controller.js`)

Mounted at `/api/mc`. All endpoints read from PostgreSQL, never from the external PFL API.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mc/teams` | All teams |
| GET | `/api/mc/matches` | Paginated matches. Query: `tournamentId`, `seasonId`, `tourId` (filters by `stage_pfl_id`), `page`, `limit` (default 20, max 100) |
| GET | `/api/mc/matches/:id` | Single match with home/away team names and scores |
| GET | `/api/mc/tours` | Distinct `(stage_pfl_id AS id, stage_name AS title)` pairs. Query: `tournamentId`, `seasonId` |
| GET | `/api/mc/sync/status` | Most recent `sync_logs` row |

---

## 5. Admin API (`server/routes/admin.js`)

Mounted at `/api/admin`. All routes guarded by `requireAdmin` middleware.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/sync` | Trigger sync. Body: `{ scope: 'full' \| 'matches' \| 'events', tournamentId?, seasonId? }` |
| GET | `/api/admin/sync/logs` | Last 20 `sync_logs` rows |
| GET | `/api/admin/sync/settings` | Current sync settings |
| PUT | `/api/admin/sync/settings` | Update interval. Body: `{ sync_interval_minutes: number }`. Calls `scheduler.reschedule()`. |
| GET | `/api/admin/configs` | Lists every folder in `uploads/templates/` with its `.pfl.json` files |
| GET | `/api/admin/configs/:folder/:template` | Read one `.pfl.json` config |
| PUT | `/api/admin/configs/:folder/:template` | Write one `.pfl.json` config (JSON body) |

---

## 6. Admin Page (Frontend)

### Routing

Add `react-router-dom`. Wrap `src/App.tsx` with `<BrowserRouter>`. Routes:
- `/` → `<Editor />` (current app, unchanged)
- `/admin` → `<AdminPage />` — redirects to `/` if user is null or `user.role !== 'admin'`

A small "Admin" link is added to the existing top-right settings area (visible only when `user.role === 'admin'`).

### `src/pages/AdminPage.tsx`

Three tabs using the existing `<Tabs>` component:

**Tab 1: Template Configs**
- Lists all template folders from `GET /api/admin/configs`
- Clicking a config opens a textarea with the JSON
- Save calls `PUT /api/admin/configs/:folder/:template`
- Shows success/error toast feedback

**Tab 2: Sync Control**
- Shows current sync interval (editable number input, Save button)
- Manual "Sync Now" button (scope selector: full / matches / events)
- Shows status of the last sync (from `GET /api/mc/sync/status`)
- Shows last 10 log entries in a table

**Tab 3: DB Status**
- Shows PostgreSQL connection status (ping query)
- Shows table row counts for key tables (matches, teams, sync_logs)

---

## 7. DataMappingModal — deferred

The Data Mapping modal continues using `/api/pfl/*` endpoints in this phase. Switching to `/api/mc/*` is a follow-up task once the database is populated via sync.

---

## New Environment Variables

```env
DATABASE_URL=postgresql://appuser:password@localhost:5432/pfl_app
# DB_PATH is no longer used (removed)
```

---

## New Dependencies

```
pg           (PostgreSQL client)
node-cron    (cron scheduler)
react-router-dom  (frontend routing)
@types/pg    (dev)
@types/react-router-dom  (dev)
```

---

## File Inventory

### New files
- `server/db/postgres.js`
- `server/db/schema.sql`
- `server/db/migrate.js`
- `server/lib/pfl-client.js`
- `server/lib/pfl-sync.js`
- `server/services/sync-scheduler.js`
- `server/routes/match-controller.js`
- `server/routes/admin.js`
- `src/pages/AdminPage.tsx`

### Modified files
- `server/db.js` — deleted
- `server/routes/auth.js` — rewrite DB calls to async pg
- `server/middleware/auth.js` — rewrite DB calls to async pg
- `server/routes/pfl.js` — remove local `requireAdmin` copy
- `server/index.js` — wire new routes, run migration on startup
- `src/App.tsx` — add BrowserRouter, routes
- `src/components/SettingsPopup.tsx` — add Admin link for admin users
- `.env.example` — add `DATABASE_URL`, remove `DB_PATH`

---

## Constraints

- PFL API key lives in `.env` only — never committed
- `limit` per PFL API page must not exceed 100
- Rate limiting: 130ms pause between paginated API requests
- Only push to `v2` remote — never to `origin` or `new-origin`
