const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

let db = null

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initializeDb() first.')
  return db
}

function initializeDb() {
  const dbPath = path.join(app.getPath('userData'), 'patch-manager.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      outlook_folder_path TEXT NOT NULL DEFAULT '',
      deployment_mode TEXT NOT NULL DEFAULT 'smb',
      server_host TEXT,
      server_port INTEGER DEFAULT 22,
      server_user TEXT,
      server_password TEXT,
      server_key_path TEXT,
      app_root_path TEXT NOT NULL DEFAULT '',
      tomcat_service_name TEXT,
      smb_path TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES apps(id),
      email_subject TEXT,
      email_sender TEXT,
      email_date TEXT,
      email_folder TEXT,
      ticket_ref TEXT,
      local_folder TEXT,
      status TEXT DEFAULT 'staged',
      deployed_at TEXT,
      deployment_mode TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patch_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patch_id INTEGER NOT NULL REFERENCES patches(id),
      original_filename TEXT NOT NULL,
      local_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      deploy_target_path TEXT,
      merge_status TEXT,
      deploy_status TEXT DEFAULT 'pending',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS deployment_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patch_id INTEGER REFERENCES patches(id),
      patch_file_id INTEGER REFERENCES patch_files(id),
      app_id INTEGER REFERENCES apps(id),
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // Migrations — safe to run on existing DBs
  try { db.exec(`ALTER TABLE patches ADD COLUMN email_entry_id TEXT`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_patches_entry ON patches(app_id, email_entry_id)`) } catch {}

  const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  insertDefault.run('patches_root_dir', 'D:\\Office\\Patches_automated')
  insertDefault.run('outlook_poll_on_startup', '0')

  console.log('[DB] Initialized at', dbPath)
  return db
}

module.exports = { initializeDb, getDb }
