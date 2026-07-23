# Match Controller + PostgreSQL Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite with PostgreSQL, add a PFL API sync service that upserts match data on a schedule, expose a Match Controller so the frontend queries its own DB, and add an admin-only page for template config editing and sync control.

**Architecture:** All server files use CommonJS (`require`/`module.exports`). A single `pg` Pool lives in `server/db/postgres.js`; everything else imports it. Auth routes are rewritten from synchronous SQLite to async PostgreSQL — same logic, different driver. The PFL client is a shared lib; both the proxy route and the sync service import it. The scheduler uses `node-cron`; the admin API can restart it live.

**Tech Stack:** Node.js (CommonJS), PostgreSQL 14+, `pg`, `node-cron`, React 18, TypeScript, `react-router-dom` v6, Emotion CSS, axios

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/db/postgres.js` | Create | `pg` Pool singleton |
| `server/db/schema.sql` | Create | Full DB schema (idempotent) |
| `server/db/migrate.js` | Create | Run schema on startup |
| `server/lib/pfl-client.js` | Create | PFL API fetch helpers |
| `server/lib/pfl-sync.js` | Create | Upsert logic (teams, matches, events, referees) |
| `server/services/sync-scheduler.js` | Create | `node-cron` wrapper with reschedule/triggerNow |
| `server/routes/match-controller.js` | Create | `/api/mc/*` read-only endpoints |
| `server/routes/admin.js` | Create | `/api/admin/*` protected endpoints |
| `server/db.js` | Delete | Replaced by postgres.js |
| `server/middleware/auth.js` | Rewrite | Use async `pool.query()` instead of SQLite sync API |
| `server/routes/auth.js` | Rewrite | Use async `pool.query()` instead of SQLite sync API |
| `server/routes/pfl.js` | Modify | Remove local `pflFetch`/`requireAdmin` dupes, import from lib/middleware |
| `server/index.js` | Modify | Run migration on startup, mount new routers |
| `src/App.tsx` | Modify | Wrap with `BrowserRouter`, add `/admin` route |
| `src/components/SettingsPopup.tsx` | Modify | Add Admin link for admin-role users |
| `src/pages/AdminPage.tsx` | Create | Admin UI — configs, sync control, DB status |
| `.env.example` | Modify | Replace `DB_PATH` with `DATABASE_URL` |

---

## Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
cd "C:\MYFILES\Github_repo\React-Canva-editor-srcfold"
npm install pg node-cron react-router-dom
```

Expected: pg, node-cron, react-router-dom appear in `dependencies` in package.json.

- [ ] **Step 2: Install dev type defs**

```bash
npm install --save-dev @types/pg @types/node-cron @types/react-router-dom
```

- [ ] **Step 3: Verify**

```bash
node -e "const { Pool } = require('pg'); console.log('pg ok')"
node -e "const cron = require('node-cron'); console.log('cron ok')"
```

Expected output: `pg ok` then `cron ok` (no errors).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: Add pg, node-cron, react-router-dom dependencies"
```

---

## Task 2: PostgreSQL schema

**Files:**
- Create: `server/db/schema.sql`

- [ ] **Step 1: Create the schema file**

Write `server/db/schema.sql`:

```sql
-- Auth
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

-- PFL reference data
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

-- Match data
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

-- Referees
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

-- Player cards
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

-- Sync infrastructure
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

- [ ] **Step 2: Commit**

```bash
git add server/db/schema.sql
git commit -m "feat: Add PostgreSQL schema"
```

---

## Task 3: PostgreSQL pool and migration runner

**Files:**
- Create: `server/db/postgres.js`
- Create: `server/db/migrate.js`

- [ ] **Step 1: Create pool singleton**

Write `server/db/postgres.js`:

```js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = pool;
```

- [ ] **Step 2: Create migration runner**

Write `server/db/migrate.js`:

```js
const fs = require('fs');
const path = require('path');
const pool = require('./postgres');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);

  // Seed default sync interval if not present
  await pool.query(`
    INSERT INTO sync_settings (key, value)
    VALUES ('sync_interval_minutes', '60')
    ON CONFLICT (key) DO NOTHING
  `);

  console.log('[migrate] Database schema applied');
}

module.exports = migrate;
```

- [ ] **Step 3: Add DATABASE_URL to .env and .env.example**

Add to `.env` (your real credentials — never commit this file):
```
DATABASE_URL=postgresql://appuser:password@localhost:5432/pfl_app
```

Update `.env.example` — replace the `DB_PATH` line with:
```
# PostgreSQL connection string
DATABASE_URL=postgresql://appuser:password@localhost:5432/pfl_app
```

- [ ] **Step 4: Quick connection test**

```bash
node -e "
require('dotenv').config();
const pool = require('./server/db/postgres');
pool.query('SELECT NOW()').then(r => { console.log('DB ok:', r.rows[0].now); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `DB ok: 2026-07-23T...`

- [ ] **Step 5: Commit**

```bash
git add server/db/postgres.js server/db/migrate.js .env.example
git commit -m "feat: Add pg pool and migration runner"
```

---

## Task 4: Rewrite auth middleware to use PostgreSQL

**Files:**
- Modify: `server/middleware/auth.js`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `server/middleware/auth.js`:

```js
const pool = require('../db/postgres');

async function getSessionUser(req) {
  const token = req.cookies?.auth_token;
  if (!token) return null;

  const sessionRes = await pool.query(
    'SELECT email FROM sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  if (!sessionRes.rows[0]) return null;

  const userRes = await pool.query(
    'SELECT email, name, role FROM users WHERE email = $1',
    [sessionRes.rows[0].email]
  );
  return userRes.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

module.exports = { getSessionUser, requireAuth, requireAdmin };
```

- [ ] **Step 2: Commit**

```bash
git add server/middleware/auth.js
git commit -m "feat: Migrate auth middleware to PostgreSQL"
```

---

## Task 5: Rewrite auth routes to use PostgreSQL

**Files:**
- Modify: `server/routes/auth.js`
- Delete: `server/db.js`

- [ ] **Step 1: Rewrite auth.js**

Replace the entire contents of `server/routes/auth.js`:

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/postgres');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function cookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true';
  return { ...COOKIE_OPTIONS, secure };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existing = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      [email, passwordHash, name || null, 'user']
    );

    const token = `tok_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      'INSERT INTO sessions (token, email, expires_at) VALUES ($1, $2, $3)',
      [token, email, expiresAt]
    );

    res.cookie('auth_token', token, cookieOptions());
    return res.json({ success: true, user: { email, name: name || null } });
  } catch (err) {
    console.error('[auth/signup]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = `tok_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      'INSERT INTO sessions (token, email, expires_at) VALUES ($1, $2, $3)',
      [token, email, expiresAt]
    );

    res.cookie('auth_token', token, cookieOptions());
    return res.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.auth_token;
    if (token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }
    res.clearCookie('auth_token', { path: '/' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/user
router.get('/user', requireAuth, (req, res) => {
  return res.json({ success: true, user: req.user });
});

// POST /api/auth/password
router.post('/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [req.user.email]);
    const user = result.rows[0];

    if (!(await bcrypt.compare(oldPassword, user.password_hash))) {
      return res.status(400).json({ error: 'Incorrect old password' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [newHash, req.user.email]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth/password]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Update server/index.js — run migration on startup, remove old db.js reference**

Replace the entire contents of `server/index.js`:

```js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const migrate = require('./db/migrate');
const authRouter = require('./routes/auth');
const imagesRouter = require('./routes/images');
const templatesRouter = require('./routes/templates');
const fontsRouter = require('./routes/fonts');
const pflRouter = require('./routes/pfl');
const matchControllerRouter = require('./routes/match-controller');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: isProd ? false : (process.env.CORS_ORIGIN || 'http://localhost:5173'),
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/auth', authRouter);
app.use('/api/images', imagesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/pfl', pflRouter);
app.use('/api/mc', matchControllerRouter);
app.use('/api/admin', adminRouter);

const { Router } = require('express');
const r2Router = Router();
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
const safePath = p => {
  const n = path.normalize(p).replace(/\\/g, '/');
  return n.startsWith('..') ? null : n;
};
r2Router.get('/get/:filename', (req, res) => {
  const safe = safePath(req.params.filename);
  if (!safe) return res.status(400).json({ error: 'Invalid path' });
  const filePath = path.join(uploadDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.sendFile(filePath);
});
app.use('/api/r2', r2Router);

app.get('/search-fonts', (req, res, next) => {
  req.url = '/search-fonts';
  fontsRouter(req, res, next);
});
app.use('/fonts', fontsRouter);

if (isProd) {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

migrate()
  .then(() => {
    const { startScheduler } = require('./services/sync-scheduler');
    startScheduler();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      if (!isProd) console.log('Vite dev server should be running on http://localhost:5173');
    });
  })
  .catch(err => {
    console.error('Failed to run migration:', err.message);
    process.exit(1);
  });
```

- [ ] **Step 3: Delete server/db.js**

```bash
git rm server/db.js
```

- [ ] **Step 4: Test login works**

Start the server: `npm run server:dev`

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"yourpassword"}'
```

Expected: `{"success":true,"user":{"email":"...","name":"...","role":"admin"}}`

(If your user doesn't exist yet in PostgreSQL, sign up first via `/api/auth/signup`)

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js server/index.js
git commit -m "feat: Migrate auth routes to PostgreSQL, run migration on startup"
```

---

## Task 6: PFL client library

**Files:**
- Create: `server/lib/pfl-client.js`
- Modify: `server/routes/pfl.js` (remove duplicate `pflFetch`, import from lib)

- [ ] **Step 1: Create pfl-client.js**

Write `server/lib/pfl-client.js`:

```js
const PFL_BASE = 'https://api.pfl.uz/public/v1';

async function pflFetch(endpoint, query = {}) {
  const apiKey = process.env.PFL_API_KEY;
  if (!apiKey) throw new Error('PFL_API_KEY not configured in .env');

  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const url = `${PFL_BASE}${endpoint}${params.toString() ? '?' + params : ''}`;

  const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PFL API ${res.status} ${endpoint}: ${text}`);
  }
  return res.json();
}

async function fetchAllPages(endpoint, query = {}) {
  const items = [];
  let page = 1;

  while (true) {
    const data = await pflFetch(endpoint, { ...query, page, limit: 100 });
    const pageItems = data.data || data || [];
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;
    items.push(...pageItems);
    if (!data.meta?.hasNextPage) break;
    page++;
    await new Promise(r => setTimeout(r, 130)); // respect rate limit
  }

  return items;
}

async function fetchTeams() {
  return fetchAllPages('/clubs');
}

async function fetchAllMatches(tournamentId, seasonId) {
  return fetchAllPages('/matches', { tournamentId, seasonId });
}

async function fetchMatch(id) {
  return pflFetch(`/matches/${id}`);
}

async function fetchMatchEvents(id) {
  const data = await pflFetch(`/matches/${id}/events`);
  return Array.isArray(data) ? data : (data.data || []);
}

module.exports = { pflFetch, fetchAllPages, fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents };
```

- [ ] **Step 2: Update server/routes/pfl.js to use the shared client**

At the top of `server/routes/pfl.js`, replace the local `pflFetch` function and local `requireAdmin` with imports:

Remove these lines from `pfl.js` (lines 6-14 and 29-78 — the `PFL_BASE` const, local `requireAdmin`, `parseXml`, `toXml`, and local `pflFetch`):

```js
// REMOVE these from pfl.js:
const PFL_BASE = 'https://api.pfl.uz/public/v1';

function requireAdmin(req, res, next) { ... }

function parseXml(xmlStr) { ... }
function toXml(obj) { ... }

async function pflFetch(endpoint, query = {}) { ... }
```

Add these imports at the top instead:

```js
const { pflFetch } = require('../lib/pfl-client');
const { requireAdmin } = require('../middleware/auth');
```

The rest of `pfl.js` (all the route handlers) remains unchanged.

- [ ] **Step 3: Verify pfl proxy still works**

```bash
curl "http://localhost:3000/api/pfl/matches?tournamentId=2&limit=5"
```

Expected: JSON with match data (same as before the change).

- [ ] **Step 4: Commit**

```bash
git add server/lib/pfl-client.js server/routes/pfl.js
git commit -m "feat: Extract PFL client lib, clean up pfl.js duplicates"
```

---

## Task 7: PFL sync service

**Files:**
- Create: `server/lib/pfl-sync.js`

- [ ] **Step 1: Create pfl-sync.js**

Write `server/lib/pfl-sync.js`:

```js
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
  const refList = matchDetail.referees || matchDetail.referee ? [matchDetail.referee].filter(Boolean) : [];
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
  }

  return { itemsSynced: totalMatches };
}

module.exports = { syncTeams, syncMatches, syncMatchEvents, syncReferees, syncAll, discoverTournamentPairs };
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/pfl-sync.js
git commit -m "feat: Add PFL sync service (teams, matches, events, referees)"
```

---

## Task 8: Sync scheduler

**Files:**
- Create: `server/services/sync-scheduler.js`

- [ ] **Step 1: Create sync-scheduler.js**

Write `server/services/sync-scheduler.js`:

```js
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
```

- [ ] **Step 2: Verify scheduler starts without error**

Start the dev server:

```bash
npm run server:dev
```

Expected console output includes:
```
[migrate] Database schema applied
[scheduler] Started — interval: 60 min
Server running on http://localhost:3000
```

- [ ] **Step 3: Commit**

```bash
git add server/services/sync-scheduler.js
git commit -m "feat: Add sync scheduler with node-cron and live reschedule"
```

---

## Task 9: Match Controller endpoints

**Files:**
- Create: `server/routes/match-controller.js`

- [ ] **Step 1: Create match-controller.js**

Write `server/routes/match-controller.js`:

```js
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

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(`
      SELECT DISTINCT m.stage_pfl_id AS id, m.stage_name AS title, m.stage_number AS number
      FROM matches m
      ${where}
      AND m.stage_pfl_id IS NOT NULL
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
```

- [ ] **Step 2: Test MC endpoints (after a sync has run)**

```bash
# After triggering a sync from the admin panel (Task 10), test:
curl "http://localhost:3000/api/mc/teams" | head -c 200
curl "http://localhost:3000/api/mc/matches?tournamentId=2&limit=3"
curl "http://localhost:3000/api/mc/tours?tournamentId=2"
```

Expected: JSON arrays with team/match/tour data from the DB.

- [ ] **Step 3: Commit**

```bash
git add server/routes/match-controller.js
git commit -m "feat: Add Match Controller endpoints (/api/mc/*)"
```

---

## Task 10: Admin API

**Files:**
- Create: `server/routes/admin.js`

- [ ] **Step 1: Create admin.js**

Write `server/routes/admin.js`:

```js
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
```

- [ ] **Step 2: Test admin endpoints with an admin cookie**

```bash
# Login as admin first to get cookie
curl -c admin.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"yourpassword"}'

# Trigger a full sync
curl -b admin.txt -X POST http://localhost:3000/api/admin/sync \
  -H "Content-Type: application/json" \
  -d '{"scope":"full"}'

# Check logs (wait ~30 seconds for sync to run)
curl -b admin.txt http://localhost:3000/api/admin/sync/logs

# Check DB health
curl -b admin.txt http://localhost:3000/api/admin/health
```

Expected: sync log shows `status: "success"`, health shows match/team counts > 0.

- [ ] **Step 3: Commit**

```bash
git add server/routes/admin.js
git commit -m "feat: Add admin API (sync control, config CRUD, health)"
```

---

## Task 11: Admin page — React frontend

**Files:**
- Create: `src/pages/AdminPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsPopup.tsx`

- [ ] **Step 1: Create AdminPage.tsx**

Write `src/pages/AdminPage.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface SyncLog {
  id: number;
  type: string;
  status: string;
  message?: string;
  items_synced: number;
  started_at: string;
  completed_at?: string;
}

interface SyncSettings {
  sync_interval_minutes: string;
}

interface ConfigItem {
  folder: string;
  template: string;
  config: Record<string, unknown> | null;
  error?: string;
}

interface HealthData {
  db: string;
  matches: number;
  teams: number;
  syncLogs: number;
}

const styles = {
  page: { minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { background: '#1e293b', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  title: { margin: 0, fontSize: 20, fontWeight: 700 } as React.CSSProperties,
  backBtn: { background: 'none', border: '1px solid #64748b', color: '#cbd5e1', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  body: { maxWidth: 960, margin: '0 auto', padding: '32px 16px' } as React.CSSProperties,
  tabs: { display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e2e8f0' } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: active ? 700 : 400,
    color: active ? '#3b82f6' : '#64748b',
    borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    marginBottom: -2,
  }),
  card: { background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 } as React.CSSProperties,
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const },
  textarea: { width: '100%', minHeight: 200, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' as const, resize: 'vertical' as const },
  btn: (color = '#3b82f6'): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }),
  outlineBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, color: '#374151' } as React.CSSProperties,
  badge: (status: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    background: status === 'success' ? '#dcfce7' : status === 'error' ? '#fee2e2' : status === 'running' ? '#dbeafe' : '#f3f4f6',
    color: status === 'success' ? '#166534' : status === 'error' ? '#991b1b' : status === 'running' ? '#1d4ed8' : '#374151',
  }),
  row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 16 } as React.CSSProperties,
  toast: (ok: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 6, fontSize: 13, marginTop: 8,
    background: ok ? '#dcfce7' : '#fee2e2',
    color: ok ? '#166534' : '#991b1b',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#374151' } as React.CSSProperties,
  td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#4b5563' } as React.CSSProperties,
  statBox: { textAlign: 'center' as const, padding: '16px 24px', background: '#f8fafc', borderRadius: 8, flex: '1' },
  statNum: { fontSize: 28, fontWeight: 700, color: '#1e293b' } as React.CSSProperties,
  statLbl: { fontSize: 12, color: '#6b7280', marginTop: 4 } as React.CSSProperties,
};

export default function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'configs' | 'sync' | 'status'>('sync');

  // Config state
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ConfigItem | null>(null);
  const [editJson, setEditJson] = useState('');
  const [configMsg, setConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync state
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [syncInterval, setSyncInterval] = useState('60');
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncScope, setSyncScope] = useState('full');
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Status state
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const loadConfigs = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/configs');
      setConfigs(res.data);
    } catch { /* ignore */ }
  }, []);

  const loadSyncData = useCallback(async () => {
    try {
      const [settingsRes, logsRes] = await Promise.all([
        axios.get('/api/admin/sync/settings'),
        axios.get('/api/admin/sync/logs'),
      ]);
      setSyncSettings(settingsRes.data);
      setSyncInterval(settingsRes.data.sync_interval_minutes || '60');
      setSyncLogs(logsRes.data);
    } catch { /* ignore */ }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/health');
      setHealth(res.data);
      setHealthError('');
    } catch (e: any) {
      setHealthError(e.response?.data?.error || 'Connection failed');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'configs') loadConfigs();
    if (activeTab === 'sync') loadSyncData();
    if (activeTab === 'status') loadHealth();
  }, [activeTab, loadConfigs, loadSyncData, loadHealth]);

  const handleSelectConfig = (item: ConfigItem) => {
    setSelectedConfig(item);
    setEditJson(JSON.stringify(item.config, null, 2));
    setConfigMsg(null);
  };

  const handleSaveConfig = async () => {
    if (!selectedConfig) return;
    try {
      const parsed = JSON.parse(editJson);
      await axios.put(`/api/admin/configs/${selectedConfig.folder}/${selectedConfig.template}`, parsed);
      setConfigMsg({ ok: true, text: 'Saved successfully' });
      loadConfigs();
    } catch (e: any) {
      setConfigMsg({ ok: false, text: e.response?.data?.error || 'Invalid JSON or save failed' });
    }
  };

  const handleSaveInterval = async () => {
    try {
      await axios.put('/api/admin/sync/settings', { sync_interval_minutes: parseInt(syncInterval, 10) });
      setSyncMsg({ ok: true, text: `Interval updated to ${syncInterval} min` });
      loadSyncData();
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Failed to update interval' });
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await axios.post('/api/admin/sync', { scope: syncScope });
      setSyncMsg({ ok: true, text: `${syncScope} sync triggered — check logs below` });
      setTimeout(loadSyncData, 3000);
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Sync trigger failed' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return null;
  if (!user || user.role !== 'admin') return null;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin Panel</h1>
        <button style={styles.backBtn} onClick={() => navigate('/')}>← Back to Editor</button>
      </div>

      <div style={styles.body}>
        <div style={styles.tabs}>
          {(['sync', 'configs', 'status'] as const).map(tab => (
            <button key={tab} style={styles.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab === 'sync' ? 'Sync Control' : tab === 'configs' ? 'Template Configs' : 'DB Status'}
            </button>
          ))}
        </div>

        {/* ── Sync Control ──────────────────────────────────────────── */}
        {activeTab === 'sync' && (
          <>
            <div style={styles.card}>
              <label style={styles.label}>Sync Interval (minutes)</label>
              <div style={styles.row}>
                <input
                  type="number"
                  min={1}
                  style={{ ...styles.input, maxWidth: 120 }}
                  value={syncInterval}
                  onChange={e => setSyncInterval(e.target.value)}
                />
                <button style={styles.btn()} onClick={handleSaveInterval}>Save Interval</button>
              </div>

              <label style={styles.label}>Manual Sync</label>
              <div style={styles.row}>
                <select
                  style={{ ...styles.input, maxWidth: 160 }}
                  value={syncScope}
                  onChange={e => setSyncScope(e.target.value)}
                >
                  <option value="full">Full sync</option>
                  <option value="matches">Matches only</option>
                  <option value="events">Events only</option>
                </select>
                <button
                  style={styles.btn(syncing ? '#9ca3af' : '#10b981')}
                  onClick={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? 'Triggering…' : 'Sync Now'}
                </button>
                <button style={styles.outlineBtn} onClick={loadSyncData}>Refresh</button>
              </div>
              {syncMsg && <div style={styles.toast(syncMsg.ok)}>{syncMsg.text}</div>}
            </div>

            <div style={styles.card}>
              <label style={styles.label}>Recent Sync Logs</label>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Items</th>
                    <th style={styles.th}>Started</th>
                    <th style={styles.th}>Duration</th>
                    <th style={styles.th}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.length === 0 && (
                    <tr><td colSpan={6} style={{ ...styles.td, color: '#9ca3af', textAlign: 'center' }}>No sync logs yet</td></tr>
                  )}
                  {syncLogs.map(log => {
                    const duration = log.completed_at
                      ? `${Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)}s`
                      : '—';
                    return (
                      <tr key={log.id}>
                        <td style={styles.td}>{log.type}</td>
                        <td style={styles.td}><span style={styles.badge(log.status)}>{log.status}</span></td>
                        <td style={styles.td}>{log.items_synced}</td>
                        <td style={styles.td}>{new Date(log.started_at).toLocaleString()}</td>
                        <td style={styles.td}>{duration}</td>
                        <td style={{ ...styles.td, color: log.status === 'error' ? '#991b1b' : undefined }}>{log.message || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Template Configs ──────────────────────────────────────── */}
        {activeTab === 'configs' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ ...styles.card, width: 220, flexShrink: 0, padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
              {configs.length === 0 && (
                <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>No configs found</div>
              )}
              {configs.map(item => (
                <button
                  key={`${item.folder}/${item.template}`}
                  onClick={() => handleSelectConfig(item)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                    background: selectedConfig?.folder === item.folder && selectedConfig?.template === item.template ? '#eff6ff' : 'none',
                    border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    color: '#1e293b', fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.folder}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{item.template}</div>
                </button>
              ))}
            </div>

            <div style={{ flex: 1 }}>
              {!selectedConfig ? (
                <div style={{ ...styles.card, color: '#9ca3af', textAlign: 'center' }}>
                  Select a config from the left to edit it
                </div>
              ) : (
                <div style={styles.card}>
                  <label style={styles.label}>{selectedConfig.folder} / {selectedConfig.template}.pfl.json</label>
                  <textarea
                    style={styles.textarea}
                    value={editJson}
                    onChange={e => { setEditJson(e.target.value); setConfigMsg(null); }}
                    spellCheck={false}
                  />
                  <div style={{ marginTop: 12 }}>
                    <button style={styles.btn()} onClick={handleSaveConfig}>Save Config</button>
                  </div>
                  {configMsg && <div style={styles.toast(configMsg.ok)}>{configMsg.text}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DB Status ─────────────────────────────────────────────── */}
        {activeTab === 'status' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <label style={{ ...styles.label, marginBottom: 0 }}>Database Status</label>
              <button style={styles.outlineBtn} onClick={loadHealth}>Refresh</button>
            </div>

            {healthError && <div style={styles.toast(false)}>{healthError}</div>}

            {health && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <span style={styles.badge(health.db === 'connected' ? 'success' : 'error')}>
                    PostgreSQL: {health.db}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { label: 'Matches', value: health.matches },
                    { label: 'Teams', value: health.teams },
                    { label: 'Sync Logs', value: health.syncLogs },
                  ].map(({ label, value }) => (
                    <div key={label} style={styles.statBox}>
                      <div style={styles.statNum}>{value.toLocaleString()}</div>
                      <div style={styles.statLbl}>{label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to add routing**

Replace the entire contents of `src/App.tsx`:

```tsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AuthPopup } from './components/AuthPopup';
import { SettingsPopup } from './components/SettingsPopup';
import Editor from './Editor';
import AdminPage from './pages/AdminPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={
            <>
              <Editor />
              <AuthPopup />
              <SettingsPopup />
            </>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 3: Add Admin link in SettingsPopup (for admin users)**

In `src/components/SettingsPopup.tsx`, add `useNavigate` and an Admin link button.

Import at the top:
```tsx
import { useNavigate } from 'react-router-dom';
```

Inside the `SettingsPopup` component, add `const navigate = useNavigate();` and `const { user }` from `useAuth`:

```tsx
export const SettingsPopup: React.FC = () => {
  const { showSettingsPopup, setShowSettingsPopup, user } = useAuth();
  const navigate = useNavigate();
  // ... existing state ...
```

Add an Admin button just before the `<Input>` for old password:

```tsx
{user?.role === 'admin' && (
  <Button
    onClick={() => { setShowSettingsPopup(false); navigate('/admin'); }}
    style={{ background: '#1e293b', marginBottom: 16 }}
  >
    Go to Admin Panel
  </Button>
)}
```

- [ ] **Step 4: Verify in browser**

Start the dev server: `npm run dev`

1. Navigate to `http://localhost:5173` — editor should load normally.
2. Log in as an admin user.
3. Open Settings popup — should show "Go to Admin Panel" button.
4. Click it — should navigate to `http://localhost:5173/admin`.
5. On the Sync Control tab, click "Sync Now" → check logs refresh after a few seconds.
6. On the Template Configs tab, select a `.pfl.json`, edit a value, save — verify the file changed on disk.
7. On DB Status tab, verify counts are non-zero after a sync.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminPage.tsx src/App.tsx src/components/SettingsPopup.tsx
git commit -m "feat: Add Admin page with routing, sync control, config editor"
```

---

## Task 12: Final wiring and cleanup

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Replace the existing `DB_PATH` line with:

```
# PostgreSQL connection string (replaces SQLite)
DATABASE_URL=postgresql://appuser:password@localhost:5432/pfl_app
```

Remove this line:
```
DB_PATH=./data/app.db
```

- [ ] **Step 2: Verify full server start**

```bash
npm run server:dev
```

Expected console:
```
[migrate] Database schema applied
[scheduler] Started — interval: 60 min
Server running on http://localhost:3000
```

No errors. No references to `server/db.js`.

- [ ] **Step 3: Final commit**

```bash
git add .env.example
git commit -m "chore: Update .env.example for PostgreSQL"
```

- [ ] **Step 4: Push to v2 remote only**

```bash
git push v2 main
```

**IMPORTANT:** Do NOT push to `origin` or `new-origin`.

---

## Self-Review Checklist

**Spec coverage:**
- [x] PostgreSQL pool + schema — Tasks 2–3
- [x] Auth migration to async pg — Tasks 4–5
- [x] `server/db.js` deleted — Task 5
- [x] PFL client lib (pflFetch, fetchAllPages, fetchTeams, fetchAllMatches, fetchMatch, fetchMatchEvents) — Task 6
- [x] Sync service (syncTeams, syncMatches, syncMatchEvents, syncReferees, syncAll, discoverTournamentPairs) — Task 7
- [x] Sync scheduler with reschedule + triggerNow — Task 8
- [x] Match Controller endpoints (teams, tours, matches paginated, match/:id, sync/status) — Task 9
- [x] Admin API (sync trigger, logs, settings, health, configs CRUD) — Task 10
- [x] AdminPage with 3 tabs — Task 11
- [x] App.tsx + BrowserRouter + /admin route — Task 11
- [x] SettingsPopup Admin link — Task 11
- [x] `local requireAdmin` removed from pfl.js — Task 6
- [x] `.env.example` updated — Task 12
- [x] Only push to `v2` — Task 12

**Constraints verified:**
- PFL_API_KEY stays in `.env` — never written to code in this plan
- `limit` capped at 100 per page — enforced in `fetchAllPages`
- 130ms pause between API pages — in `fetchAllPages`
- Push only to `v2` — noted in Task 12
