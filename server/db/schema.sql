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
  group_pfl_id INTEGER,
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

-- Per-tournament auto-sync schedules
CREATE TABLE IF NOT EXISTS tournament_sync_configs (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL,
  season_id INTEGER,
  matches_interval_minutes INTEGER NOT NULL DEFAULT 60,
  matches_enabled BOOLEAN NOT NULL DEFAULT false,
  events_interval_minutes INTEGER NOT NULL DEFAULT 60,
  events_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_pfl_id INTEGER;
ALTER TABLE tournament_sync_configs
  ADD COLUMN IF NOT EXISTS standings_interval_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS standings_enabled BOOLEAN NOT NULL DEFAULT false;
