const fs   = require('fs')
const path = require('path')
const os   = require('os')

function sftpOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 30000, retries: 0 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  if (app.sftp_server_path) opts.sftpServerPath = app.sftp_server_path
  return opts
}

function sshOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 30000 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  return opts
}

// Build a .war (ZIP) from localSrcPath contents → returns path to temp .war file
function buildWar(localSrcPath, warName) {
  const AdmZip  = require('adm-zip')
  const zip     = new AdmZip()
  zip.addLocalFolder(localSrcPath)
  const tmpPath = path.join(os.tmpdir(), `${warName}.war`)
  zip.writeZip(tmpPath)
  return tmpPath
}

// Upload WAR to remote server via SFTP:
//   1. Rename existing CONVUAT.war → CONVUAT bk dd-Mon-yy.war
//   2. Upload new .war
async function deployWarSFTP(app, localWarPath, onProgress) {
  const SftpClient = require('ssh2-sftp-client')
  const sftp       = new SftpClient()
  const warName    = app.war_name
  const remoteDir  = (app.remote_war_path || '').replace(/\/$/, '')
  const remoteWar  = `${remoteDir}/${warName}.war`

  const dateTag = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit'
  }).replace(/ /g, '-')                           // e.g. "27-Aug-26"
  const backupWar = `${remoteDir}/${warName} bk ${dateTag}.war`

  try {
    await sftp.connect(sftpOpts(app))
    onProgress?.('Connected to server')

    // Rename existing WAR to backup
    try {
      await sftp.rename(remoteWar, backupWar)
      onProgress?.(`Backed up existing WAR → ${warName} bk ${dateTag}.war`)
    } catch {
      onProgress?.('No existing WAR to back up (first deploy)')
    }

    // Upload new WAR
    onProgress?.(`Uploading ${path.basename(localWarPath)}…`)
    await sftp.fastPut(localWarPath, remoteWar, {
      step: (transferred, chunk, total) => {
        const pct = Math.round((transferred / total) * 100)
        onProgress?.(`Uploading… ${pct}%`)
      }
    })
    onProgress?.('Upload complete')
    await sftp.end()
  } catch (e) {
    try { await sftp.end() } catch {}
    throw e
  }
}

// Restart Tomcat over SSH
async function restartTomcatSSH(app) {
  const { Client } = require('ssh2')

  let cmd
  if (app.tomcat_remote_path) {
    const t = app.tomcat_remote_path.replace(/\/$/, '')
    cmd = `${t}/bin/shutdown.sh 2>&1; sleep 4; ${t}/bin/startup.sh 2>&1`
  } else if (app.tomcat_service_name) {
    const name = app.tomcat_service_name
    cmd = `sudo systemctl restart ${name} 2>&1 || sudo service ${name} restart 2>&1`
  } else {
    throw new Error('No Tomcat path or service name configured')
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let out = ''
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('data', d => { out += d.toString() })
        stream.stderr.on('data', d => { out += d.toString() })
        stream.on('close', () => { conn.end(); resolve(out.trim()) })
      })
    })
    conn.on('error', reject)
    conn.connect(sshOpts(app))
  })
}

module.exports = { buildWar, deployWarSFTP, restartTomcatSSH }
