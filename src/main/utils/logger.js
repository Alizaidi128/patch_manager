const fs = require('fs')
const path = require('path')

const LOG_DIR  = path.join(__dirname, '../../../logs')
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB rotate

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

function rotate() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
      fs.renameSync(LOG_FILE, path.join(LOG_DIR, `app.${ts}.log`))
    }
  } catch {}
}

function pktNow() {
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000)
  return pkt.toISOString().slice(0, 23).replace('T', ' ') + ' PKT'
}

function fmt(a) {
  if (a instanceof Error) return `${a.message}\n  Stack: ${(a.stack || '').split('\n').slice(1, 4).join('\n  ')}`
  if (typeof a === 'object' && a !== null) return JSON.stringify(a)
  return String(a)
}

function write(level, ...args) {
  const ts  = pktNow()
  const msg = args.map(fmt).join(' ')
  const line = `[${ts}] [${level.padEnd(5)}] ${msg}\n`

  if (level === 'ERROR') console.error(line.trimEnd())
  else if (level === 'QUERY') {} // SQL-only, skip console
  else console.log(line.trimEnd())

  try {
    ensureDir()
    rotate()
    fs.appendFileSync(LOG_FILE, line)
  } catch {}
}

// Log a DB query with its bound parameters
function query(sql, params) {
  const clean  = sql.replace(/\s+/g, ' ').trim()
  const pStr   = params && params.length ? `  params: [${params.map(p => JSON.stringify(p)).join(', ')}]` : ''
  write('QUERY', `${clean}${pStr}`)
}

// Log a visual section separator (operation start)
function section(name, detail = '') {
  const bar = '─'.repeat(60)
  write('INFO ', `\n${bar}\n  ▶ ${name}${detail ? '  |  ' + detail : ''}\n${bar}`)
}

function logDeployment({ patchId, patchFileId, appId, action, status, detail }) {
  try {
    const { addLogEntry } = require('../db/queries')
    addLogEntry({ patch_id: patchId, patch_file_id: patchFileId || null, app_id: appId, action, status, detail })
  } catch (e) {
    write('ERROR', 'logDeployment failed', e.message)
  }
}

module.exports = {
  info:    (...a) => write('INFO ', ...a),
  warn:    (...a) => write('WARN ', ...a),
  error:   (...a) => write('ERROR', ...a),
  debug:   (...a) => write('DEBUG', ...a),
  query,
  section,
  logDeployment,
  logFile:  LOG_FILE,
  logDir:   LOG_DIR,
}
