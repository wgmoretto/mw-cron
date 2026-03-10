import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

let db;

export async function initDatabase() {
  const SQL = await initSqlJs();
  const dbDir = path.dirname(config.dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(config.dbPath)) {
    const buffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  migrate();
  saveDatabase();

  // Auto-save every 30 seconds
  setInterval(saveDatabase, 30000);

  return db;
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      expected_code INTEGER NOT NULL DEFAULT 200,
      timeout_sec INTEGER NOT NULL DEFAULT 10,
      cron_expr TEXT NOT NULL DEFAULT '*/5 * * * *',
      post_body TEXT DEFAULT '',
      headers TEXT DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT DEFAULT 'unknown',
      last_check_at TEXT,
      last_latency INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS check_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id INTEGER NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      error_msg TEXT DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_check_logs_endpoint_time
    ON check_logs(endpoint_id, checked_at DESC)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notification_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT DEFAULT '',
      bot_token TEXT DEFAULT '',
      chat_id TEXT DEFAULT '',
      notify_on_down INTEGER NOT NULL DEFAULT 1,
      notify_on_up INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed default notification configs
  const count = db.exec("SELECT COUNT(*) as c FROM notification_configs")[0]?.values[0][0] || 0;
  if (count === 0) {
    db.run("INSERT INTO notification_configs (channel) VALUES ('discord')");
    db.run("INSERT INTO notification_configs (channel) VALUES ('telegram')");
  }
}

export function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

export function getDb() {
  return db;
}
