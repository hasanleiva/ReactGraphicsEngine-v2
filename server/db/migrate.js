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
