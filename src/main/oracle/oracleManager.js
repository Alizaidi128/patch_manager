const { safeStorage } = require('electron')

let _oracledb = null
function getOracle() {
  if (!_oracledb) _oracledb = require('oracledb')
  return _oracledb
}

const connections = new Map() // Map<string(appId), Connection>

function encryptPassword(plainText) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption not available')
  return safeStorage.encryptString(plainText).toString('base64')
}

function decryptPassword(encBase64) {
  return safeStorage.decryptString(Buffer.from(encBase64, 'base64'))
}

function connectString(params) {
  return `${params.db_host}:${params.db_port || 1521}/${params.db_service_name}`
}

async function getConnection(appId, appRow) {
  const key = String(appId)
  if (connections.has(key)) {
    const conn = connections.get(key)
    try { await conn.ping(); return conn } catch {
      try { await conn.close() } catch {}
      connections.delete(key)
    }
  }
  const db = getOracle()
  const password = appRow.db_password_enc ? decryptPassword(appRow.db_password_enc) : ''
  const conn = await db.getConnection({ user: appRow.db_user, password, connectString: connectString(appRow) })
  connections.set(key, conn)
  return conn
}

async function closeConnection(appId) {
  const key = String(appId)
  if (connections.has(key)) {
    try { await connections.get(key).close() } catch {}
    connections.delete(key)
  }
}

async function testConnection(params) {
  const db = getOracle()
  const password = params.db_password || (params.db_password_enc ? decryptPassword(params.db_password_enc) : '')
  let conn
  try {
    conn = await db.getConnection({ user: params.db_user, password, connectString: connectString(params) })
    await conn.ping()
    await conn.close()
    return { success: true, message: `Connected to ${connectString(params)} as ${params.db_user}` }
  } catch (e) {
    if (conn) { try { await conn.close() } catch {} }
    return { success: false, message: e.message }
  }
}

function parseOracleSql(sql) {
  const statements = []
  const lines = sql.split(/\r?\n/)
  let current = []
  let inBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!inBlock && (!trimmed || /^--/.test(trimmed) || /^REM\s/i.test(trimmed))) continue

    if (!inBlock) {
      if (/^(BEGIN|DECLARE)\b/i.test(trimmed) ||
          /^CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE|JAVA)\b/i.test(trimmed)) {
        inBlock = true
        current.push(line)
        continue
      }
    }

    if (inBlock) {
      if (trimmed === '/') {
        const stmt = current.join('\n').trim()
        if (stmt) statements.push(stmt)
        current = []
        inBlock = false
      } else {
        current.push(line)
      }
      continue
    }

    current.push(line)
    if (trimmed.endsWith(';')) {
      const stmt = current.join('\n').trim().replace(/;$/, '').trim()
      if (stmt) statements.push(stmt)
      current = []
    }
  }

  const remainder = current.join('\n').trim().replace(/;$/, '').trim()
  if (remainder) statements.push(remainder)

  return statements.filter(Boolean)
}

async function runScript(appId, appRow, sqlContent, onProgress) {
  const conn = await getConnection(appId, appRow)
  const statements = parseOracleSql(sqlContent)
  const results = []

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (onProgress) onProgress({ index: i, total: statements.length, stmt: stmt.slice(0, 80) })
    try {
      const result = await conn.execute(stmt, [], { autoCommit: true })
      results.push({ index: i, stmt: stmt.slice(0, 300), success: true, rowsAffected: result.rowsAffected ?? null })
    } catch (e) {
      results.push({ index: i, stmt: stmt.slice(0, 300), success: false, error: e.message })
      // Continue to next statement (Option B — run all, report failures inline)
    }
  }

  const failed = results.filter(r => !r.success)
  return {
    success: failed.length === 0,
    results,
    error: failed.length > 0 ? `${failed.length} of ${statements.length} statement(s) failed` : null
  }
}

module.exports = { encryptPassword, decryptPassword, testConnection, runScript, closeConnection, parseOracleSql }
