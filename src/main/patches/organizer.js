// Phase 3 — Patch folder creation and sequence numbering
const fs   = require('fs')
const path = require('path')
const { formatDateFolder } = require('../utils/dateFormat')
const { getAllSettings }   = require('../db/queries')

function getPatchRootDir() {
  return getAllSettings().patches_root_dir || 'D:\\Office\\Patches_automated'
}

function getNextSequenceFolder(dateFolder) {
  if (!fs.existsSync(dateFolder)) {
    fs.mkdirSync(dateFolder, { recursive: true })
    return 1
  }
  const existing = fs.readdirSync(dateFolder)
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n))
  return existing.length === 0 ? 1 : Math.max(...existing) + 1
}

function createPatchFolder(emailDate) {
  const root       = getPatchRootDir()
  const dateStr    = formatDateFolder(emailDate || new Date())
  const dateFolder = path.join(root, dateStr)
  const seq        = getNextSequenceFolder(dateFolder)
  const seqFolder  = path.join(dateFolder, String(seq))
  fs.mkdirSync(seqFolder, { recursive: true })
  return seqFolder
}

module.exports = { createPatchFolder, getPatchRootDir }
