// Phase 5 — SMB / local Windows server deployment + Tomcat restart
const fs     = require('fs')
const path   = require('path')
const { exec } = require('child_process')
const { logDeployment } = require('../utils/logger')

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

async function restartTomcat(serviceName) {
  return new Promise((resolve, reject) => {
    exec(`net stop "${serviceName}" && net start "${serviceName}"`, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message))
      resolve(stdout)
    })
  })
}

async function deploy(patchFiles, app, options = {}) {
  // Implemented in Phase 5
  throw new Error('SMB deploy: implement in Phase 5')
}

module.exports = { deploy, copyRecursive, restartTomcat }
