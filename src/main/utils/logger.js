const fs = require('fs')
const path = require('path')

const LOG_DIR = path.join(__dirname, '../../../logs')
const LOG_FILE = path.join(LOG_DIR, 'app.log')
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB rotate

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

function rotate() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE.replace('.log', '.1.log'))
    }
  } catch {}
}

function pktNow() {
  // PKT = UTC+5, no DST
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000)
  return pkt.toISOString().slice(0, 19).replace('T', ' ') + ' PKT'
}

function write(level, ...args) {
  const ts = pktNow()
  const msg = args.map(a =>
    a instanceof Error ? `${a.message}\n${a.stack}` :
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ')
  const line = `[${ts}] [${level}] ${msg}\n`

  // Always mirror to terminal
  if (level === 'ERROR') console.error(line.trimEnd())
  else console.log(line.trimEnd())

  try {
    ensureDir()
    rotate()
    fs.appendFileSync(LOG_FILE, line)
  } catch {}
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
  info:  (...a) => write('INFO',  ...a),
  warn:  (...a) => write('WARN',  ...a),
  error: (...a) => write('ERROR', ...a),
  debug: (...a) => write('DEBUG', ...a),
  logDeployment,
  logFile: LOG_FILE,
}
