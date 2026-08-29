// Phase 3 — Patch folder creation and sequence numbering
const fs   = require('fs')
const path = require('path')
const { formatDateFolder } = require('../utils/dateFormat')
const { getAllSettings }   = require('../db/queries')

function getPatchRootDir() {
  return getAllSettings().patches_root_dir || 'D:\\Office\\Patches_automated'
}

function createPatchFolder(emailDate, appName, rootOverride, seqHint = null) {
  const root    = rootOverride || getPatchRootDir()
  const dateStr = formatDateFolder(emailDate || new Date())
  const safeApp = (appName || 'UNKNOWN').replace(/[\\/:*?"<>|]/g, '_').trim() || 'UNKNOWN'
  // Structure: {root}/{APP_NAME}/{date}/{seq}
  const dateFolder = path.join(root, safeApp, dateStr)
  if (!fs.existsSync(dateFolder)) fs.mkdirSync(dateFolder, { recursive: true })

  // Start from seqHint (chronological rank from DB) if given, else use max+1
  let seq
  if (seqHint !== null && seqHint >= 1) {
    seq = seqHint
  } else {
    const existing = fs.readdirSync(dateFolder).map(n => parseInt(n, 10)).filter(n => !isNaN(n))
    seq = existing.length === 0 ? 1 : Math.max(...existing) + 1
  }

  // Increment until a free slot (handles collisions)
  let seqFolder = path.join(dateFolder, String(seq))
  while (fs.existsSync(seqFolder)) {
    seq++
    seqFolder = path.join(dateFolder, String(seq))
  }

  fs.mkdirSync(seqFolder, { recursive: true })
  return seqFolder
}

module.exports = { createPatchFolder, getPatchRootDir }
