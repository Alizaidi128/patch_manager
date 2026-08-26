const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { getDb }                        = require('../db/schema')
const { updatePatchFile, updatePatch } = require('../db/queries')
const { logDeployment }                = require('../utils/logger')

// ---- Helpers ----

function getContext(patchId) {
  const db    = getDb()
  const patch = db.prepare('SELECT * FROM patches WHERE id = ?').get(patchId)
  if (!patch) throw new Error(`Patch ${patchId} not found`)
  const app   = db.prepare('SELECT * FROM apps WHERE id = ?').get(patch.app_id)
  const files = db.prepare('SELECT * FROM patch_files WHERE patch_id = ? ORDER BY id').all(patchId)
  return { patch, app, files }
}

function walkDir(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, acc)
    else acc.push(full)
  }
  return acc
}

function sftpOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 20000, retries: 0 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  return opts
}

function sshOpts(app) {
  const opts = { host: app.server_host, port: app.server_port || 22, username: app.server_user, readyTimeout: 20000 }
  if (app.server_key_path) opts.privateKey = fs.readFileSync(app.server_key_path)
  else opts.password = app.server_password
  return opts
}

// Check all patch_files; update patch.status to 'deployed' if all done
function checkPatchComplete(patchId) {
  const db = getDb()
  const files = db.prepare('SELECT deploy_status FROM patch_files WHERE patch_id = ?').all(patchId)
  if (!files.length) return
  const allDone = files.every(f => f.deploy_status === 'deployed' || f.deploy_status === 'skipped')
  if (allDone) updatePatch(patchId, { status: 'deployed', deployed_at: new Date().toISOString() })
}

// ---- SMB deployment ----

function backupAndCopySMB(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let bak = null
  if (fs.existsSync(dest)) {
    bak = `${dest}.bak-${Date.now()}`
    fs.copyFileSync(dest, bak)
  }
  fs.copyFileSync(src, dest)
  return bak
}

function deployFileSMB(file) {
  backupAndCopySMB(file.local_path, file.deploy_target_path)
}

function deployGiasSMB(extractedDir, appRootPath) {
  const srcFiles = walkDir(extractedDir)
  const deployed = []
  for (const src of srcFiles) {
    const rel  = path.relative(extractedDir, src)
    const dest = path.join(appRootPath, rel)
    backupAndCopySMB(src, dest)
    deployed.push({ rel, dest })
  }
  return deployed
}

function restartTomcatSMB(serviceName) {
  const { spawnSync } = require('child_process')
  const ps = `Restart-Service -Name '${serviceName}' -Force -ErrorAction Stop`
  const r  = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60000 })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').toString().trim() || 'Restart failed')
}

// ---- SFTP deployment ----

async function deploySFTP(filesToDeploy, app) {
  const SftpClient = require('ssh2-sftp-client')
  const sftp = new SftpClient()
  const results = []
  try {
    await sftp.connect(sftpOpts(app))
    for (const item of filesToDeploy) {
      const dest = item.deploy_target_path
      const remoteDir = dest.replace(/\\/g, '/').replace(/\/[^/]+$/, '')
      try { await sftp.mkdir(remoteDir, true) } catch {}
      try { await sftp.rename(dest, `${dest}.bak-${Date.now()}`) } catch {}
      await sftp.fastPut(item.local_path, dest)
      results.push({ id: item.id, success: true })
    }
    await sftp.end()
  } catch (e) {
    try { await sftp.end() } catch {}
    throw e
  }
  return results
}

async function deployGiasSFTP(extractedDir, appRootPath, app) {
  const SftpClient = require('ssh2-sftp-client')
  const sftp = new SftpClient()
  try {
    await sftp.connect(sftpOpts(app))
    const srcFiles = walkDir(extractedDir)
    for (const src of srcFiles) {
      const rel  = path.relative(extractedDir, src).replace(/\\/g, '/')
      const dest = `${appRootPath.replace(/\\/g, '/')}/${rel}`
      const remoteDir = dest.replace(/\/[^/]+$/, '')
      try { await sftp.mkdir(remoteDir, true) } catch {}
      try { await sftp.rename(dest, `${dest}.bak-${Date.now()}`) } catch {}
      await sftp.fastPut(src, dest)
    }
    await sftp.end()
  } catch (e) {
    try { await sftp.end() } catch {}
    throw e
  }
}

async function restartTomcatSFTP(app) {
  const { Client } = require('ssh2')
  const name = app.tomcat_service_name || 'tomcat'
  const cmd  = `sudo systemctl restart ${name} 2>&1 || sudo service ${name} restart 2>&1`
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let out = ''
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('data', d => { out += d })
        stream.stderr.on('data', d => { out += d })
        stream.on('close', code => {
          conn.end()
          if (code !== 0) reject(new Error(`Tomcat restart exit ${code}: ${out.trim()}`))
          else resolve(out.trim())
        })
      })
    })
    conn.on('error', reject)
    conn.connect(sshOpts(app))
  })
}

// ---- Public API ----

function previewDeploy(patchId) {
  const { patch, app, files } = getContext(patchId)

  const deployable    = []
  const nonDeployable = []

  for (const f of files) {
    if (f.deploy_status === 'deployed') {
      nonDeployable.push({ ...f, reason: 'Already deployed' }); continue
    }
    if (f.deploy_status === 'skipped') {
      nonDeployable.push({ ...f, reason: 'Skipped' }); continue
    }
    if (f.merge_status === 'merged') {
      nonDeployable.push({ ...f, reason: 'Already merged (counts as deployed)' }); continue
    }
    if (f.file_type === 'db_script') {
      nonDeployable.push({ ...f, reason: 'DB scripts must be applied manually by a DBA — never auto-deployed' }); continue
    }
    if (f.file_type === 'reference') {
      nonDeployable.push({ ...f, reason: 'Reference document — no deployment needed' }); continue
    }
    if (f.file_type === 'gias_patch') {
      const extractedDir = path.join(path.dirname(f.local_path), 'extracted')
      if (!fs.existsSync(extractedDir)) {
        nonDeployable.push({ ...f, reason: 'Extracted directory not found. Was it extracted?' }); continue
      }
      const subFiles = walkDir(extractedDir).map(p => path.relative(extractedDir, p))
      deployable.push({ ...f, action: 'gias', extractedDir, subFiles, deployBase: app.app_root_path }); continue
    }
    if (!f.deploy_target_path) {
      nonDeployable.push({ ...f, reason: 'No deployment path set — use Set Path or Preview Merge first' }); continue
    }
    if (f.file_type === 'xml_merge' || f.file_type === 'props_merge') {
      deployable.push({ ...f, action: 'deploy', note: 'Tip: use Preview Merge instead for a safe diff.' }); continue
    }
    deployable.push({ ...f, action: 'deploy' })
  }

  const tomcatAvailable = !!(app.tomcat_service_name)
  return { deployable, nonDeployable, app, patch, tomcatAvailable }
}

async function executeDeploy({ patchId, fileIds, restartTomcat }) {
  const { patch, app, files } = getContext(patchId)
  const selected = files.filter(f => fileIds.includes(f.id))
  const results  = []

  if (app.deployment_mode === 'sftp') {
    // Group regular and GIAS files separately
    const regular = selected.filter(f => f.file_type !== 'gias_patch')
    const gias    = selected.filter(f => f.file_type === 'gias_patch')

    // Regular files — single connection
    if (regular.length) {
      try {
        await deploySFTP(regular, app)
        for (const f of regular) {
          updatePatchFile(f.id, { deploy_status: 'deployed' })
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'success', detail: f.deploy_target_path })
          results.push({ id: f.id, filename: f.original_filename, success: true })
        }
      } catch (e) {
        for (const f of regular) {
          updatePatchFile(f.id, { deploy_status: 'failed' })
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'failed', detail: e.message })
          results.push({ id: f.id, filename: f.original_filename, success: false, error: e.message })
        }
      }
    }

    // GIAS files
    for (const f of gias) {
      const extractedDir = path.join(path.dirname(f.local_path), 'extracted')
      try {
        await deployGiasSFTP(extractedDir, app.app_root_path, app)
        updatePatchFile(f.id, { deploy_status: 'deployed' })
        logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'success', detail: `→ ${app.app_root_path}` })
        results.push({ id: f.id, filename: f.original_filename, success: true })
      } catch (e) {
        updatePatchFile(f.id, { deploy_status: 'failed' })
        logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'failed', detail: e.message })
        results.push({ id: f.id, filename: f.original_filename, success: false, error: e.message })
      }
    }

  } else {
    // SMB — synchronous
    for (const f of selected) {
      try {
        if (f.file_type === 'gias_patch') {
          const extractedDir = path.join(path.dirname(f.local_path), 'extracted')
          deployGiasSMB(extractedDir, app.app_root_path)
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'success', detail: `→ ${app.app_root_path}` })
        } else {
          deployFileSMB(f)
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'success', detail: f.deploy_target_path })
        }
        updatePatchFile(f.id, { deploy_status: 'deployed' })
        results.push({ id: f.id, filename: f.original_filename, success: true })
      } catch (e) {
        updatePatchFile(f.id, { deploy_status: 'failed' })
        logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'failed', detail: e.message })
        results.push({ id: f.id, filename: f.original_filename, success: false, error: e.message })
      }
    }
  }

  // Tomcat restart
  let tomcatResult = null
  if (restartTomcat && app.tomcat_service_name) {
    try {
      if (app.deployment_mode === 'sftp') await restartTomcatSFTP(app)
      else restartTomcatSMB(app.tomcat_service_name)
      tomcatResult = { success: true, message: `${app.tomcat_service_name} restarted` }
      logDeployment({ patchId, appId: patch.app_id, action: 'tomcat-restart', status: 'success', detail: app.tomcat_service_name })
    } catch (e) {
      tomcatResult = { success: false, message: e.message }
      logDeployment({ patchId, appId: patch.app_id, action: 'tomcat-restart', status: 'failed', detail: e.message })
    }
  }

  checkPatchComplete(patchId)
  return { results, tomcatResult }
}

function markManual({ patchId, fileIds }) {
  const db   = getDb()
  const patch = db.prepare('SELECT app_id FROM patches WHERE id = ?').get(patchId)
  for (const fileId of fileIds) {
    const f = db.prepare('SELECT original_filename FROM patch_files WHERE id = ?').get(fileId)
    updatePatchFile(fileId, { deploy_status: 'deployed' })
    logDeployment({
      patchId, patchFileId: fileId, appId: patch.app_id,
      action: 'mark-manual', status: 'success',
      detail: f ? f.original_filename : String(fileId)
    })
  }
  checkPatchComplete(patchId)
  return { success: true }
}

module.exports = { previewDeploy, executeDeploy, markManual }
