const { getDb } = require('../db/schema')

function logDeployment({ patchId, patchFileId, appId, action, status, detail }) {
  try {
    getDb().prepare(`
      INSERT INTO deployment_log (patch_id, patch_file_id, app_id, action, status, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(patchId ?? null, patchFileId ?? null, appId ?? null, action, status, detail ?? null)
  } catch (err) {
    console.error('[Logger] Failed to write log entry:', err.message)
  }
}

module.exports = { logDeployment }
