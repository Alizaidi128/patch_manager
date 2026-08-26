// Phase 5 — RDP-assisted staging (copies to a local staging folder, opens Explorer)
const fs   = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { getAllSettings } = require('../db/queries')
const { formatDateFolder } = require('../utils/dateFormat')

function getStagingDir(appName) {
  const root = getAllSettings().patches_root_dir || 'D:\\Office\\Patches_automated'
  return path.join(root, 'STAGED', appName, formatDateFolder())
}

async function stage(patchFiles, app) {
  // Implemented in Phase 5
  throw new Error('RDP-assisted staging: implement in Phase 5')
}

module.exports = { stage, getStagingDir }
