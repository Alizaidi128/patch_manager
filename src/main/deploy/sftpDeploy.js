// Phase 5 — SFTP deployment to Linux servers
const SftpClient = require('ssh2-sftp-client')
const { logDeployment } = require('../utils/logger')

async function deploy(patchFiles, app, options = {}) {
  // Implemented in Phase 5
  throw new Error('SFTP deploy: implement in Phase 5')
}

module.exports = { deploy }
