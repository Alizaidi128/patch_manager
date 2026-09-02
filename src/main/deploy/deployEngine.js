const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { getDb }                        = require('../db/schema')
const { updatePatchFile, updatePatch } = require('../db/queries')
const { logDeployment } = require('../utils/logger')

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
  if (app.sftp_server_path) opts.sftpServerPath = app.sftp_server_path
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

// ---- Path resolution ----

function resolveDestSMB(file, app, rootOverride) {
  let p = (file.deploy_target_path || '').trim().replace(/[*?]/g, '')
  const isAbsolute = path.isAbsolute(p) || p.startsWith('\\\\') || p.startsWith('//')
  if (!isAbsolute) {
    const base = rootOverride || (app && (app.smb_path || app.app_root_path))
    if (base) p = path.join(base, p)
  }
  // Append filename if the path doesn't already end with it
  if (!p.toLowerCase().endsWith(file.original_filename.toLowerCase())) {
    p = path.join(p, file.original_filename)
  }
  return p
}

function resolveDestSFTP(file, app) {
  let p = (file.deploy_target_path || '').trim().replace(/\\/g, '/').replace(/[*?]/g, '')
  const isAbsolute = p.startsWith('/')
  if (!isAbsolute && app && app.app_root_path) {
    const root = app.app_root_path.replace(/\\/g, '/').replace(/\/$/, '')
    p = `${root}/${p}`
  }
  if (!p.endsWith(file.original_filename)) {
    p = `${p.replace(/\/$/, '')}/${file.original_filename}`
  }
  return p
}

// ---- SMB deployment ----

function backupAndCopySMB(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return null
}

function plainCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (fs.existsSync(dest)) {
    fs.copyFileSync(dest, `${dest}.bak-${Date.now()}`)
  }
  fs.copyFileSync(src, dest)
}

function deployGiasLocal(extractedDir, localRoot) {
  const deployRoot = giasDeployRoot(extractedDir)
  const srcFiles = walkDir(deployRoot).filter(src => isAllowedGiasFile(path.relative(deployRoot, src)))
  const deployed = []
  for (const src of srcFiles) {
    const rel  = path.relative(deployRoot, src)
    const dest = path.join(localRoot, rel)
    plainCopy(src, dest)
    deployed.push({ rel, dest })
  }
  return deployed
}

function deployFileSMB(file, app) {
  const dest = resolveDestSMB(file, app)
  backupAndCopySMB(file.local_path, dest)
  return dest
}

// GIAS RARs often have one top-level wrapper folder (e.g. GIAS_Reserved_Folders).
// Strip it so files land relative to app root. But do NOT strip known structural
// web-app folders like WEB-INF — those ARE part of the path.
const STRUCTURAL_DIRS = /^(WEB-INF|META-INF|genins|classes|lib|webapps|src|resources|static|templates)$/i

// Whitelist of valid top-level app folders. Files from a GIAS patch whose first path
// component is NOT in this set are ignored — they belong to a different app or are
// packaging artefacts that must not land in this app's directory.
const ALLOWED_APP_FOLDERS = new Set([
  'di', 'genins', 'glas', 'gnled', 'healthins',
  'meta-inf', 'para', 'param', 'secman',
  'shmalib', 'shsm', 'web-inf', 'wf',
])

function isAllowedGiasFile(relPath) {
  const first = relPath.split(/[\\/]/)[0].toLowerCase()
  return ALLOWED_APP_FOLDERS.has(first)
}

// Target dir for extracting a GIAS archive — always named after the archive.
function rarExtractTarget(archivePath) {
  return path.join(path.dirname(archivePath), path.basename(archivePath, path.extname(archivePath)))
}

// Find where a GIAS archive was previously extracted (detection).
// Checks: named dir first, then legacy 'extracted/', then parent dir itself (in-place extraction).
function rarExtractDir(archivePath) {
  const named = rarExtractTarget(archivePath)
  if (fs.existsSync(named)) return named
  const legacy = path.join(path.dirname(archivePath), 'extracted')
  if (fs.existsSync(legacy)) return legacy
  return legacy  // fallback path (may not exist — callers must check)
}

function giasDeployRoot(extractedDir, depth = 0) {
  if (depth > 5) return extractedDir  // guard against infinite loops
  try {
    const entries = fs.readdirSync(extractedDir, { withFileTypes: true })
    if (entries.length === 1 && entries[0].isDirectory() && !STRUCTURAL_DIRS.test(entries[0].name)) {
      return giasDeployRoot(path.join(extractedDir, entries[0].name), depth + 1)
    }
  } catch {}
  return extractedDir
}

function deployGiasSMB(extractedDir, appRootPath) {
  const deployRoot = giasDeployRoot(extractedDir)
  const srcFiles = walkDir(deployRoot).filter(src => isAllowedGiasFile(path.relative(deployRoot, src)))
  const deployed = []
  for (const src of srcFiles) {
    const rel  = path.relative(deployRoot, src)
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
      const dest = resolveDestSFTP(item, app)
      const remoteDir = dest.replace(/\/[^/]+$/, '')
      try { await sftp.mkdir(remoteDir, true) } catch {}
      try { await sftp.rename(dest, `${dest}.bak-${Date.now()}`) } catch {}
      await sftp.fastPut(item.local_path, dest)
      results.push({ id: item.id, dest, success: true })
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
    const deployRoot = giasDeployRoot(extractedDir)
    const srcFiles = walkDir(deployRoot).filter(src => isAllowedGiasFile(path.relative(deployRoot, src)))
    for (const src of srcFiles) {
      const rel  = path.relative(deployRoot, src).replace(/\\/g, '/')
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
  let cmd = app.tomcat_restart_cmd
    ? app.tomcat_restart_cmd
    : `sudo systemctl restart ${name} 2>&1 || sudo service ${name} restart 2>&1`

  // If a run-as user is configured (e.g. "oracle"), wrap with sudo su - user -c "..."
  // This is needed when the SSH login user differs from the Tomcat process owner.
  const runAs = (app.tomcat_run_as_user || '').trim()
  if (runAs) {
    // Escape single quotes in the command before embedding in -c '...'
    const escaped = cmd.replace(/'/g, `'"'"'`)
    cmd = `sudo su - ${runAs} -c '${escaped}'`
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let out = ''
    conn.on('ready', () => {
      // Request a PTY — required for sudo su - to work without a password prompt
      const execOpts = runAs ? { pty: { rows: 24, cols: 80, term: 'vt100' } } : {}
      conn.exec(cmd, execOpts, (err, stream) => {
        if (err) { conn.end(); return reject(err) }
        stream.on('data', d => { out += d })
        stream.stderr.on('data', d => { out += d })
        stream.on('close', (code) => {
          conn.end()
          // With PTY, exit code is sometimes unreliable — check for error keywords in output
          const failed = code !== 0 || /permission denied|error|failed/i.test(out) && !/started|running/i.test(out)
          if (failed && code !== 0) reject(new Error(`Tomcat restart exit ${code}: ${out.trim()}`))
          else resolve(out.trim())
        })
      })
    })
    conn.on('error', reject)
    conn.connect(sshOpts(app))
  })
}

// ---- Helpers ----

function fmtDate(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '')
}

// Return the local deploy root for a given app + mode
function localDeployRoot(app) {
  if (app.deployment_mode === 'sftp') return app.local_src_path || app.app_root_path
  // smb and rdp_assisted both deploy to a local/UNC path
  return app.smb_path || app.app_root_path
}

// ---- Public API ----

function previewDeploy(patchId, { batchPatchIds = [] } = {}) {
  const { patch, app, files } = getContext(patchId)

  // Block deploy if any older patch for the same app is not yet deployed.
  const db = getDb()
  const excludeIds = batchPatchIds.filter(id => id !== patchId)
  let blockSql = `
    SELECT id, email_subject, email_date, status FROM patches
    WHERE app_id = ? AND id != ? AND status NOT IN ('deployed')
      AND (email_date < ? OR (email_date = ? AND id < ?))
  `
  const blockParams = [patch.app_id, patchId, patch.email_date, patch.email_date, patchId]
  if (excludeIds.length) {
    blockSql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`
    blockParams.push(...excludeIds)
  }
  blockSql += ' ORDER BY email_date ASC, id ASC'
  const blockedBy = db.prepare(blockSql).all(...blockParams)
  if (blockedBy.length > 0) {
    return { deployable: [], nonDeployable: [], app, patch, tomcatAvailable: false, blockedBy }
  }

  const deployRoot = localDeployRoot(app)
  const deployable    = []
  const nonDeployable = []

  // Email date baseline — used to catch files falsely auto-marked as deployed (same file
  // in multiple patches; the older patch's deploy updated the server, so the newer patch's
  // file looks "already deployed" by mtime, but it hasn't been deployed yet from THIS patch).
  const emailMs = patch.email_date ? new Date(patch.email_date).getTime() : 0

  for (const f of files) {
    if (f.deploy_status === 'deployed') {
      // Check if this "deployed" file actually needs re-deploying, using email_date as baseline.
      // A file needs re-deploying if the local copy predates this email (meaning a later patch
      // updated it or the auto-detect was wrong), or if it is missing from the destination.
      if (emailMs > 0 && f.deploy_target_path && f.file_type !== 'db_script' && f.file_type !== 'reference') {
        if (f.file_type === 'gias_patch' && f.local_path) {
          const extractedDir = rarExtractDir(f.local_path)
          if (fs.existsSync(extractedDir)) {
            const dRoot    = giasDeployRoot(extractedDir)
            const srcFiles = walkDir(dRoot)
            const needsDeploy = srcFiles.some(src => {
              const dest = path.join(deployRoot, path.relative(dRoot, src))
              if (!fs.existsSync(dest)) return true
              try { return fs.statSync(dest).mtimeMs < emailMs } catch { return true }
            })
            if (needsDeploy) {
              const subFiles = srcFiles.map(p => path.relative(dRoot, p))
              deployable.push({ ...f, action: 'gias', extractedDir, subFiles, deployBase: deployRoot, note: 'Re-deploying (local source predates this email)' }); continue
            }
          }
        } else {
          try {
            const dest = resolveDestSMB(f, app, deployRoot)
            if (!dest || !fs.existsSync(dest) || fs.statSync(dest).mtimeMs < emailMs) {
              deployable.push({ ...f, action: 'deploy', note: 'Re-deploying (destination predates this email)' }); continue
            }
          } catch {}
        }
      } else if (app.deployment_mode === 'sftp' && app.local_src_path && f.local_path && f.file_type !== 'gias_patch') {
        // Legacy fallback (no email_date): re-deploy if missing from local source folder
        const localDest = resolveDestSMB(f, app, app.local_src_path)
        if (!fs.existsSync(localDest)) {
          deployable.push({ ...f, action: 'deploy', note: 'Re-deploying (missing from local source folder)' }); continue
        }
      }

      nonDeployable.push({ ...f, reason: 'Already deployed', canForce: true }); continue
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
      const extractedDir = rarExtractDir(f.local_path)
      const deployBase   = deployRoot

      if (!fs.existsSync(extractedDir)) {
        if (f.local_path && fs.existsSync(f.local_path)) {
          deployable.push({ ...f, action: 'gias', extractedDir, subFiles: [], deployBase, note: 'Archive will be extracted on deploy' }); continue
        }
        nonDeployable.push({ ...f, reason: 'Extracted directory not found and archive is missing' }); continue
      }

      const dRoot    = giasDeployRoot(extractedDir)
      const srcFiles = walkDir(dRoot).filter(src => isAllowedGiasFile(path.relative(dRoot, src)))
      const subFiles = srcFiles.map(p => path.relative(dRoot, p))

      // Check per-file status using email_date as the reference — not file mtime.
      // A dest file is considered "already from this patch" if its mtime >= email_date.
      // This handles the case where two patches share the same archive with identical file mtimes.
      if (deployBase && emailMs > 0) {
        const needsDeploy = srcFiles.filter(src => {
          const dest = path.join(deployBase, path.relative(dRoot, src))
          if (!fs.existsSync(dest)) return true
          try { return fs.statSync(dest).mtimeMs < emailMs } catch { return true }
        })
        if (needsDeploy.length === 0) {
          const alreadyDeployed = srcFiles.filter(src => {
            const dest = path.join(deployBase, path.relative(dRoot, src))
            try { return fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= emailMs } catch { return false }
          })
          const label = app.deployment_mode === 'sftp' ? 'local source' : 'app'
          const reason = alreadyDeployed.length
            ? `${alreadyDeployed.length} ${label} file(s) already deployed from this or a later patch`
            : 'All files are already up to date'
          nonDeployable.push({ ...f, reason, canForce: true, subFiles, deployBase }); continue
        }
      } else if (deployBase) {
        // Fallback when no email_date: compare file mtimes directly
        const needsDeploy = srcFiles.filter(src => {
          const dest = path.join(deployBase, path.relative(dRoot, src))
          return !fs.existsSync(dest) || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs
        })
        if (needsDeploy.length === 0) {
          nonDeployable.push({ ...f, reason: 'All files are already up to date', canForce: true, subFiles, deployBase }); continue
        }
      }

      deployable.push({ ...f, action: 'gias', extractedDir, subFiles, deployBase }); continue
    }

    if (!f.deploy_target_path) {
      nonDeployable.push({ ...f, reason: 'No deployment path set — use Set Path or Preview Merge first' }); continue
    }

    // Check if the destination is already up to date, using email_date as the reference.
    // If the dest file was last written after this email arrived, it's already been deployed
    // (either by this patch on a previous run, or by a later patch that supersedes it).
    if (f.local_path && fs.existsSync(f.local_path) && deployRoot) {
      const dest = resolveDestSMB(f, app, deployRoot)
      if (fs.existsSync(dest)) {
        try {
          const destMtime = fs.statSync(dest).mtimeMs
          const alreadyDone = emailMs > 0 ? destMtime >= emailMs : destMtime > fs.statSync(f.local_path).mtimeMs
          if (alreadyDone) {
            const reason = emailMs > 0
              ? `Already deployed (file updated ${fmtDate(destMtime)}, email received ${fmtDate(emailMs)})`
              : `App file is newer (${fmtDate(destMtime)}) than patch file`
            nonDeployable.push({ ...f, reason, canForce: true }); continue
          }
        } catch {}
      }
    }

    if (f.file_type === 'xml_merge' || f.file_type === 'props_merge') {
      deployable.push({ ...f, action: 'deploy', note: 'Tip: use Preview Merge instead for a safe diff.' }); continue
    }
    deployable.push({ ...f, action: 'deploy' })
  }

  const tomcatAvailable = !!(app.tomcat_service_name)
  // For RDP-Assisted: include credential hint so deploy dialog can show it
  const credentialHint = app.deployment_mode === 'rdp_assisted' && app.server_password
    ? { host: app.smb_path || app.app_root_path, user: app.server_user, password: app.server_password }
    : null
  return { deployable, nonDeployable, app, patch, tomcatAvailable, blockedBy: [], credentialHint }
}

async function executeDeploy({ patchId, fileIds, restartTomcat }) {
  const { patch, app, files } = getContext(patchId)
  const selected = files.filter(f => fileIds.includes(f.id))
  const results  = []

  if (app.deployment_mode === 'sftp') {
    // SFTP mode: patch files are copied locally into local_src_path (the WAR source folder).
    // The WAR deploy button then zips that folder and uploads it to the Linux server.
    const localRoot = app.local_src_path || app.app_root_path
    for (const f of selected) {
      try {
        let dest
        if (f.file_type === 'gias_patch') {
          const extractedDir = rarExtractDir(f.local_path)
          const deployed = deployGiasLocal(extractedDir, localRoot)
          dest = `${localRoot} (${deployed.length} files)`
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'success', detail: dest })
        } else {
          dest = resolveDestSMB(f, app, localRoot)
          plainCopy(f.local_path, dest)
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'success', detail: dest })
        }
        updatePatchFile(f.id, { deploy_status: 'deployed' })
        results.push({ id: f.id, filename: f.original_filename, success: true, dest })
      } catch (e) {
        updatePatchFile(f.id, { deploy_status: 'failed' })
        logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'failed', detail: e.message })
        results.push({ id: f.id, filename: f.original_filename, success: false, error: e.message })
      }
    }

  } else if (app.deployment_mode === 'rdp_assisted') {
    // RDP-Assisted: deploy to UNC network path; try net use for auth first
    if (app.server_user && app.server_password && (app.smb_path || app.app_root_path)) {
      const unc    = (app.smb_path || app.app_root_path).replace(/^(\\\\[^\\]+).*$/, '$1')
      const { spawnSync } = require('child_process')
      spawnSync('net', ['use', unc, `/user:${app.server_user}`, app.server_password], { stdio: 'pipe' })
    }
    for (const f of selected) {
      try {
        let dest
        if (f.file_type === 'gias_patch') {
          let extractedDir = rarExtractDir(f.local_path)
          if (!fs.existsSync(extractedDir) && f.local_path && fs.existsSync(f.local_path)) {
            const { extract } = require('../patches/extractor')
            extractedDir = rarExtractTarget(f.local_path)
            await extract(f.local_path, extractedDir)
          }
          const rdpRoot = app.smb_path || app.app_root_path
          const deployed = deployGiasSMB(extractedDir, rdpRoot)
          dest = `${rdpRoot} (${deployed.length} files)`
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'success', detail: dest })
        } else {
          dest = resolveDestSMB(f, app)
          backupAndCopySMB(f.local_path, dest)
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'success', detail: dest })
        }
        updatePatchFile(f.id, { deploy_status: 'deployed' })
        results.push({ id: f.id, filename: f.original_filename, success: true, dest })
      } catch (e) {
        updatePatchFile(f.id, { deploy_status: 'failed' })
        logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'failed', detail: e.message })
        results.push({ id: f.id, filename: f.original_filename, success: false, error: e.message })
      }
    }

  } else {
    // SMB — synchronous (extraction may be async)
    for (const f of selected) {
      try {
        let dest
        if (f.file_type === 'gias_patch') {
          let extractedDir = rarExtractDir(f.local_path)
          // Auto-extract if the user copied the archive without extracting first
          if (!fs.existsSync(extractedDir) && f.local_path && fs.existsSync(f.local_path)) {
            const { extract } = require('../patches/extractor')
            extractedDir = rarExtractTarget(f.local_path)
            await extract(f.local_path, extractedDir)
          }
          const smbRoot = app.smb_path || app.app_root_path
          const deployed = deployGiasSMB(extractedDir, smbRoot)
          dest = `${smbRoot} (${deployed.length} files)`
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy-gias', status: 'success', detail: dest })

        } else {
          dest = deployFileSMB(f, app)
          logDeployment({ patchId, patchFileId: f.id, appId: patch.app_id, action: 'deploy', status: 'success', detail: dest })
        }
        updatePatchFile(f.id, { deploy_status: 'deployed' })
        results.push({ id: f.id, filename: f.original_filename, success: true, dest })
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

// Check each staged patch's files against the deployed app directory.
// Returns array of { fileId, status: 'deployed'|'pending' } for files that have a deploy target.
//
// IMPORTANT: We compare against email_date (when this email arrived), NOT the local patch file's
// mtime. Two patches can contain the same file with identical mtimes — using file mtime would
// falsely mark Patch B as deployed just because Patch A already put that file on the server.
// Using email_date means: "was the server file updated after we received this email?" If yes →
// deployed. If the server file predates this email → still pending.
function checkDeploymentStatus(patchId) {
  try {
    const { patch, app, files } = getContext(patchId)
    if (patch.status !== 'staged') return []
    const deployRoot = localDeployRoot(app)
    const results = []

    // Baseline: the moment this email arrived. Server files must be newer than this to count
    // as having been deployed FROM this patch (or a later one that supersedes it).
    const emailMs = patch.email_date ? new Date(patch.email_date).getTime() : 0

    for (const f of files) {
      if (f.deploy_status !== 'pending') continue

      if (f.file_type === 'gias_patch' && f.local_path) {
        if (!deployRoot) continue
        const extractedDir = rarExtractDir(f.local_path)
        if (!fs.existsSync(extractedDir)) continue
        const dRoot    = giasDeployRoot(extractedDir)
        const srcFiles = walkDir(dRoot).filter(src => isAllowedGiasFile(path.relative(dRoot, src)))
        if (!srcFiles.length) continue

        const allDeployed = emailMs > 0 && srcFiles.every(src => {
          const dest = path.join(deployRoot, path.relative(dRoot, src))
          if (!fs.existsSync(dest)) return false
          try {
            return fs.statSync(dest).mtimeMs >= emailMs
          } catch { return false }
        })
        results.push({ fileId: f.id, status: allDeployed ? 'deployed' : 'pending' })
        continue
      }

      if (f.deploy_target_path && f.local_path &&
          f.file_type !== 'db_script' && f.file_type !== 'reference') {
        // For SFTP mode: check the local_src_path folder (where files land before WAR build),
        // not the remote server path. deployRoot already resolves to local_src_path for SFTP.
        const dest = resolveDestSMB(f, app, deployRoot)
        if (!dest || !fs.existsSync(dest)) { results.push({ fileId: f.id, status: 'pending' }); continue }
        try {
          const deployed = emailMs > 0 && fs.statSync(dest).mtimeMs >= emailMs
          results.push({ fileId: f.id, status: deployed ? 'deployed' : 'pending' })
        } catch { results.push({ fileId: f.id, status: 'pending' }) }
      }
    }

    return results
  } catch { return [] }
}

module.exports = { previewDeploy, executeDeploy, markManual, checkDeploymentStatus, localDeployRoot }
