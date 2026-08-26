const { getDb } = require('./schema')

// ---- Settings ----

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

function saveSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
}

function saveSettings(settings) {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  getDb().transaction(s => {
    for (const [key, value] of Object.entries(s)) stmt.run(key, String(value ?? ''))
  })(settings)
}

// ---- Apps ----

function getAllApps() {
  return getDb().prepare('SELECT * FROM apps ORDER BY is_active DESC, name ASC').all()
}

function getApp(id) {
  return getDb().prepare('SELECT * FROM apps WHERE id = ?').get(id)
}

function saveApp(appData) {
  const { id, ...fields } = appData
  if (id) {
    const setCols = Object.keys(fields).map(k => `${k} = @${k}`).join(', ')
    getDb().prepare(`UPDATE apps SET ${setCols}, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id })
    return id
  } else {
    const cols = Object.keys(fields).join(', ')
    const vals = Object.keys(fields).map(k => `@${k}`).join(', ')
    const result = getDb().prepare(`INSERT INTO apps (${cols}) VALUES (${vals})`).run(fields)
    return result.lastInsertRowid
  }
}

function deleteApp(id) {
  getDb().prepare('DELETE FROM apps WHERE id = ?').run(id)
}

// ---- Patches ----

function getPatchesForApp(appId, filters = {}) {
  let sql = 'SELECT * FROM patches WHERE app_id = ?'
  const params = [appId]
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status) }
  if (filters.since) { sql += ' AND email_date >= ?'; params.push(filters.since) }
  if (filters.until) { sql += ' AND email_date <= ?'; params.push(filters.until) }
  sql += ' ORDER BY email_date DESC'
  const patches = getDb().prepare(sql).all(...params)
  return patches.map(p => ({
    ...p,
    files: getDb().prepare('SELECT * FROM patch_files WHERE patch_id = ? ORDER BY id').all(p.id)
  }))
}

function getPatchById(id) {
  return getDb().prepare('SELECT * FROM patches WHERE id = ?').get(id)
}

function createPatch(data) {
  const cols = Object.keys(data).join(', ')
  const vals = Object.keys(data).map(k => `@${k}`).join(', ')
  const result = getDb().prepare(`INSERT INTO patches (${cols}) VALUES (${vals})`).run(data)
  return result.lastInsertRowid
}

function updatePatch(id, updates) {
  const setCols = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE patches SET ${setCols} WHERE id = @id`).run({ ...updates, id })
}

function getPendingPatchCount(appId) {
  const row = getDb().prepare(
    `SELECT COUNT(*) as cnt FROM patches WHERE app_id = ? AND status IN ('staged','ready')`
  ).get(appId)
  return row.cnt
}

// ---- Patch Files ----

function getPatchFiles(patchId) {
  return getDb().prepare('SELECT * FROM patch_files WHERE patch_id = ?').all(patchId)
}

function createPatchFile(data) {
  const cols = Object.keys(data).join(', ')
  const vals = Object.keys(data).map(k => `@${k}`).join(', ')
  const result = getDb().prepare(`INSERT INTO patch_files (${cols}) VALUES (${vals})`).run(data)
  return result.lastInsertRowid
}

function updatePatchFile(id, updates) {
  const setCols = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE patch_files SET ${setCols} WHERE id = @id`).run({ ...updates, id })
}

// ---- Deployment Log ----

function addLogEntry(entry) {
  const cols = Object.keys(entry).join(', ')
  const vals = Object.keys(entry).map(k => `@${k}`).join(', ')
  getDb().prepare(`INSERT INTO deployment_log (${cols}) VALUES (${vals})`).run(entry)
}

function getLogEntries(filters = {}) {
  let sql = `
    SELECT dl.*, a.name as app_name
    FROM deployment_log dl
    LEFT JOIN apps a ON dl.app_id = a.id
    WHERE 1=1
  `
  const params = []
  if (filters.appId) { sql += ' AND dl.app_id = ?'; params.push(filters.appId) }
  if (filters.since) { sql += ' AND dl.logged_at >= ?'; params.push(filters.since) }
  if (filters.until) { sql += ' AND dl.logged_at <= ?'; params.push(filters.until) }
  if (filters.status) { sql += ' AND dl.status = ?'; params.push(filters.status) }
  sql += ' ORDER BY dl.logged_at DESC LIMIT 1000'
  return getDb().prepare(sql).all(...params)
}

module.exports = {
  getAllSettings, saveSetting, saveSettings,
  getAllApps, getApp, saveApp, deleteApp,
  getPatchesForApp, getPatchById, createPatch, updatePatch, getPendingPatchCount,
  getPatchFiles, createPatchFile, updatePatchFile,
  addLogEntry, getLogEntries
}
