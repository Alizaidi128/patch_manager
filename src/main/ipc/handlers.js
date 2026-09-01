const { ipcMain, dialog, shell, app } = require('electron')
const log = require('../utils/logger')
const {
  getAllSettings, saveSettings,
  getAllApps, saveApp, deleteApp,
  getPatchesForApp, getPatchById, getPatchFiles,
  updatePatch, updatePatchFile, getLogEntries, deletePatch
} = require('../db/queries')

// Wrap an IPC handler: logs channel + key args, times the call, logs result/error
function handle(channel, fn, summarize) {
  ipcMain.handle(channel, async (event, ...args) => {
    const summary = summarize ? summarize(...args) : (args.length ? JSON.stringify(args[0]).slice(0, 120) : '')
    log.section(`IPC ${channel}`, summary)
    const t0 = Date.now()
    try {
      const result = await fn(event, ...args)
      log.info(`[IPC] ${channel} → OK  (${Date.now() - t0}ms)`)
      return result
    } catch (e) {
      log.error(`[IPC] ${channel} → FAIL (${Date.now() - t0}ms)`, e)
      throw e
    }
  })
}

function registerHandlers() {

  // ---- Settings ----
  ipcMain.handle('settings:get', async () => getAllSettings())

  ipcMain.handle('settings:save', async (_, settings) => {
    saveSettings(settings)
    return { success: true }
  })

  // ---- Native dialogs ----
  ipcMain.handle('dialog:browse-folder', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog({
      defaultPath: defaultPath || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:browse-file', async (_, opts = {}) => {
    const result = await dialog.showOpenDialog({
      defaultPath: opts.defaultPath || app.getPath('home'),
      filters: opts.filters || [],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('shell:open-folder', async (_, folderPath) => {
    await shell.openPath(folderPath)
    return { success: true }
  })

  // ---- Apps ----
  ipcMain.handle('app:list', async () => getAllApps())

  ipcMain.handle('app:save', async (_, appData) => {
    const id = saveApp(appData)
    return { success: true, id }
  })

  ipcMain.handle('app:delete', async (_, id) => {
    deleteApp(id)
    return { success: true }
  })

  ipcMain.handle('app:test-connection', async (_, appData) => {
    if (appData.deployment_mode !== 'sftp') {
      return { success: false, message: 'Connection test only available for SFTP mode.' }
    }
    const SftpClient = require('ssh2-sftp-client')
    const sftp = new SftpClient()
    try {
      const connectOpts = {
        host: appData.server_host,
        port: appData.server_port || 22,
        username: appData.server_user,
        readyTimeout: 8000,
        retries: 0
      }
      if (appData.server_key_path) {
        const fs = require('fs')
        connectOpts.privateKey = fs.readFileSync(appData.server_key_path)
      } else {
        connectOpts.password = appData.server_password
      }
      await sftp.connect(connectOpts)
      const cwd = await sftp.cwd()
      await sftp.end()
      return { success: true, message: `Connected. Remote home: ${cwd}` }
    } catch (e) {
      try { await sftp.end() } catch {}
      return { success: false, message: e.message }
    }
  })

  // ---- Outlook ----
  ipcMain.handle('outlook:check-running', async () => {
    const { checkRunning } = require('../email/outlookBridge')
    return checkRunning()
  })

  ipcMain.handle('outlook:get-folders', async () => {
    const { getFolders } = require('../email/outlookBridge')
    return getFolders()
  })

  // ---- Patches ----
  ipcMain.handle('patch:list', async (_, { appId, ...filters }) => {
    return getPatchesForApp(appId, filters)
  })

  // ---- Deployment log ----
  ipcMain.handle('log:list', async (_, filters = {}) => getLogEntries(filters))

  ipcMain.handle('log:export-csv', async (_, filters = {}) => {
    const rows = getLogEntries(filters)
    const { formatIso } = require('../utils/dateFormat')
    const header = 'logged_at,app_name,action,status,detail,patch_id\n'
    const csv = rows.map(r =>
      [r.logged_at, r.app_name, r.action, r.status,
        (r.detail || '').replace(/,/g, ';').replace(/\n/g, ' '), r.patch_id || ''].join(',')
    ).join('\n')

    const savePath = await dialog.showSaveDialog({
      defaultPath: `patch-log-${formatIso().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (savePath.canceled) return { canceled: true }
    require('fs').writeFileSync(savePath.filePath, header + csv, 'utf8')
    return { success: true, filePath: savePath.filePath }
  })

  // ---- Phase 3: Email fetch ----
  handle('outlook:fetch', async (_, { appIds, sinceDate, toDate }) => {
    const { fetchAll } = require('../email/fetchOrchestrator')
    const apps = getAllApps()
    const result = await fetchAll(appIds, sinceDate, apps, toDate)
    log.info(`[fetch] Result: fetched=${result.fetched}  duplicates=${result.duplicates}  missing=${result.missingPaths?.length || 0}  errors=${result.errors?.length || 0}`)
    if (result.errors?.length) result.errors.forEach(e => log.error(`[fetch] App error: ${e.appName} — ${e.error}`))
    return result
  }, ({ appIds, sinceDate, toDate }) => `apps=[${appIds?.join(',')}]  since=${sinceDate}  to=${toDate}`)

  // ---- Patch actions ----
  ipcMain.handle('patch:set-path', async (_, { patchFileId, deployPath }) => {
    const trimmed = (deployPath || '').trim()
    updatePatchFile(patchFileId, { deploy_target_path: trimmed })
    log.info(`[set-path] patchFileId=${patchFileId}  path="${trimmed}"`)
    return { success: true }
  })

  ipcMain.handle('patch:skip', async (_, { patchFileId }) => {
    updatePatchFile(patchFileId, { deploy_status: 'skipped' })
    return { success: true }
  })

  // ---- Phase 4: Merge engine ----
  handle('merge:preview', async (_, { patchFileId }) => {
    const { previewMerge } = require('../merge/mergeEngine')
    return previewMerge(patchFileId)
  }, ({ patchFileId }) => `patchFileId=${patchFileId}`)

  handle('merge:apply', async (_, { patchFileId, mergedContent }) => {
    const { applyMerge } = require('../merge/mergeEngine')
    return applyMerge(patchFileId, mergedContent)
  }, ({ patchFileId }) => `patchFileId=${patchFileId}`)

  // ---- Script view / download ----
  ipcMain.handle('patch:read-script', async (_, { localPath }) => {
    const fs = require('fs')
    try {
      const content = fs.readFileSync(localPath, 'utf8')
      return { success: true, content }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('patch:open-script', async (_, { localPath }) => {
    await shell.openPath(localPath)
    return { success: true }
  })

  ipcMain.handle('patch:open-content', async (_, { content, filename }) => {
    const os   = require('os')
    const path = require('path')
    const fs   = require('fs')
    const tmpPath = path.join(os.tmpdir(), filename || 'compiled_scripts.sql')
    fs.writeFileSync(tmpPath, content, 'utf8')
    await shell.openPath(tmpPath)
    return { success: true }
  })

  // ---- Patch delete ----
  ipcMain.handle('patch:delete', async (_, { patchId }) => {
    const patch = getPatchById(patchId)
    if (!patch) return { success: false, error: 'Patch not found' }
    if (patch.status !== 'staged') {
      return { success: false, error: `Only pending patches can be deleted (current status: ${patch.status})` }
    }
    if (patch.local_folder) {
      const fs   = require('fs')
      const path = require('path')
      try { fs.rmSync(patch.local_folder, { recursive: true, force: true }) } catch {}
      // Delete parent date folder if it is now empty
      try {
        const parent = path.dirname(patch.local_folder)
        if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
          fs.rmdirSync(parent)
        }
      } catch {}
    }
    deletePatch(patchId)
    return { success: true }
  })

  // ---- Quick reachability check for the app's server ----
  ipcMain.handle('app:check-reachable', async (_, { appId }) => {
    const net = require('net')
    const db = require('../db/schema').getDb()
    const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId)
    if (!appRow) return { reachable: true }

    let host = null
    let port = 445  // SMB default

    if (appRow.deployment_mode === 'sftp') {
      host = (appRow.server_host || '').trim()
      port = parseInt(appRow.server_port || '22', 10)
    } else {
      const p = (appRow.smb_path || appRow.app_root_path || '').trim()
      if (p.startsWith('\\\\') || p.startsWith('//')) {
        host = p.replace(/^[\\\/]+/, '').split(/[\\\/]/)[0]
      }
    }

    if (!host) {
      log.debug(`[reachability] app=${appRow.name} — no host to check, assuming reachable`)
      return { reachable: true }
    }

    return new Promise(resolve => {
      const socket = new net.Socket()
      socket.setTimeout(2000)
      socket.on('connect', () => {
        socket.destroy()
        log.info(`[reachability] app=${appRow.name}  ${host}:${port} → REACHABLE`)
        resolve({ reachable: true })
      })
      socket.on('timeout', () => {
        socket.destroy()
        log.warn(`[reachability] app=${appRow.name}  ${host}:${port} → TIMEOUT`)
        resolve({ reachable: false })
      })
      socket.on('error', (err) => {
        socket.destroy()
        log.warn(`[reachability] app=${appRow.name}  ${host}:${port} → ERROR: ${err.message}`)
        resolve({ reachable: false })
      })
      socket.connect(port, host)
    })
  })

  // ---- Auto-detect deployed status by comparing file dates with app directory ----
  ipcMain.handle('patch:auto-detect-status', async (_, { patchIds }) => {
    const { checkDeploymentStatus } = require('../deploy/deployEngine')
    const db = require('../db/schema').getDb()
    const autoDeployed = []

    log.info(`[auto-detect] Checking ${patchIds.length} staged patch(es)`)
    for (const patchId of patchIds) {
      const results = checkDeploymentStatus(patchId)
      if (!results.length) {
        log.debug(`[auto-detect] patchId=${patchId} — no checkable files`)
        continue
      }

      // Only auto-mark if every checked file is deployed
      const allDeployed = results.every(r => r.status === 'deployed')
      log.info(`[auto-detect] patchId=${patchId}  files=${results.length}  allDeployed=${allDeployed}`)
      for (const r of results) {
        if (r.status === 'deployed') {
          db.prepare(`UPDATE patch_files SET deploy_status = 'deployed' WHERE id = ? AND deploy_status = 'pending'`).run(r.fileId)
        }
      }
      if (allDeployed) {
        db.prepare(`UPDATE patches SET status = 'deployed', deployed_at = datetime('now') WHERE id = ? AND status = 'staged'`).run(patchId)
        autoDeployed.push(patchId)
        log.info(`[auto-detect] patchId=${patchId} → auto-marked deployed`)
      }
    }

    return { updated: autoDeployed }
  })

  // ---- Mark patch as deployed (for patches already deployed outside the app) ----
  ipcMain.handle('patch:mark-deployed', async (_, { patchId }) => {
    const patch = getPatchById(patchId)
    if (!patch) return { success: false, error: 'Patch not found' }
    const db = require('../db/schema').getDb()
    db.prepare(`UPDATE patches SET status = 'deployed', deployed_at = datetime('now') WHERE id = ?`).run(patchId)
    db.prepare(`UPDATE patch_files SET deploy_status = 'deployed' WHERE patch_id = ? AND deploy_status = 'pending'`).run(patchId)
    log.info(`[mark-deployed] patchId=${patchId}  subject="${patch.email_subject}"`)
    return { success: true }
  })

  // ---- Phase 5: Deployment engine ----
  handle('deploy:preview', async (_, { patchId }) => {
    const { previewDeploy } = require('../deploy/deployEngine')
    return previewDeploy(patchId)
  }, ({ patchId }) => `patchId=${patchId}`)

  handle('deploy:execute', async (_, { patchId, fileIds, restartTomcat }) => {
    const { executeDeploy } = require('../deploy/deployEngine')
    return executeDeploy({ patchId, fileIds, restartTomcat })
  }, ({ patchId, fileIds }) => `patchId=${patchId}  files=[${fileIds?.join(',')}]`)

  handle('deploy:mark-manual', async (_, { patchId, fileIds }) => {
    const { markManual } = require('../deploy/deployEngine')
    return markManual({ patchId, fileIds })
  }, ({ patchId }) => `patchId=${patchId}`)

  // ---- WAR deploy ----
  ipcMain.handle('war:deploy', async (event, { appId }) => {
    const { buildWar, deployWarSFTP } = require('../deploy/warEngine')
    const app = getAllApps().find(a => a.id === appId)
    if (!app) return { success: false, error: 'App not found' }
    if (!app.local_src_path) return { success: false, error: 'local_src_path not configured' }
    if (!app.war_name)       return { success: false, error: 'war_name not configured' }
    if (!app.app_root_path)  return { success: false, error: 'app_root_path not configured' }

    // Find the most recently deployed patch date for this app (used in backup WAR filename)
    const db = require('../db/schema').getDb()
    const lastPatch = db.prepare(
      `SELECT email_date FROM patches WHERE app_id = ? AND status = 'deployed'
       ORDER BY deployed_at DESC, email_date DESC LIMIT 1`
    ).get(appId)
    const lastPatchDate = lastPatch?.email_date || null

    const steps = []
    try {
      steps.push('Building WAR from local source…')
      event.sender.send('war:progress', { step: steps[steps.length - 1] })
      const localWar = await buildWar(app.local_src_path, app.war_name)
      steps.push(`WAR built: ${localWar}`)
      event.sender.send('war:progress', { step: steps[steps.length - 1] })

      await deployWarSFTP(app, localWar, ({ step, pct }) => {
        if (pct == null) steps.push(step)
        event.sender.send('war:progress', { step, pct })
      }, lastPatchDate)

      log.info('war:deploy success', { appId, steps })
      return { success: true, steps }
    } catch (e) {
      log.error('war:deploy failed', e)
      return { success: false, error: e.message, steps }
    }
  })

  // ---- Tomcat restart ----
  ipcMain.handle('tomcat:restart', async (_, { appId }) => {
    const app = getAllApps().find(a => a.id === appId)
    if (!app) return { success: false, error: 'App not found' }
    try {
      const { restartTomcatSSH, restartTomcatLocal, restartTomcatRDP } = require('../deploy/warEngine')
      const mode = (app.deployment_mode || '').toLowerCase()
      let out
      if (mode === 'smb') {
        out = await restartTomcatLocal(app)
      } else if (mode === 'rdp_assisted' || mode === 'rdp') {
        out = await restartTomcatRDP(app)
      } else if (mode === 'sftp') {
        out = await restartTomcatSSH(app)
      } else {
        throw new Error(`Tomcat restart is not supported for deployment mode "${mode}"`)
      }
      log.info('tomcat:restart success', { appId, out })
      return { success: true, output: out }
    } catch (e) {
      log.error('tomcat:restart failed', e)
      if (e.needsRdp) {
        return {
          success: false, needsRdp: true,
          rdpHost: e.rdpHost, rdpPort: e.rdpPort,
          rdpPassword: e.rdpPassword, rdpCommand: e.rdpCommand
        }
      }
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('rdp:open', async (_, { host, port }) => {
    const { exec } = require('child_process')
    const target = port && port !== 3389 ? `${host}:${port}` : host
    exec(`mstsc /v:${target}`)
    return { success: true }
  })

  // ---- Comprehensive deployment status detection ----
  handle('patch:detect-all', async (_, { appId }) => {
    const { detectAllStatus } = require('../deploy/detector')
    return detectAllStatus(appId)
  }, ({ appId }) => `appId=${appId}`)

  // ---- Dev/test: revert deployed patches back to staged ----
  ipcMain.handle('debug:revert-patches', async (_, { appId }) => {
    const db = require('../db/schema').getDb()
    const patches = db.prepare(
      `SELECT id FROM patches WHERE app_id = ? AND status = 'deployed'`
    ).all(appId)
    for (const p of patches) {
      db.prepare(`UPDATE patches SET status = 'staged', deployed_at = NULL WHERE id = ?`).run(p.id)
      db.prepare(`UPDATE patch_files SET deploy_status = 'pending' WHERE patch_id = ? AND deploy_status = 'deployed'`).run(p.id)
    }
    return { reverted: patches.length }
  })

  // Sequential deploy for multiple patches (oldest email first)
  ipcMain.handle('deploy:batch', async (_, { patchIds }) => {
    const { previewDeploy, executeDeploy } = require('../deploy/deployEngine')
    const results = []
    for (const patchId of patchIds) {
      try {
        const preview = previewDeploy(patchId, { batchPatchIds: patchIds })
        if (preview.blockedBy?.length > 0) {
          const subjects = preview.blockedBy.map(p => p.email_subject?.slice(0, 40) || `#${p.id}`).join(', ')
          results.push({ patchId, error: `Blocked by older undeployed patch(es): ${subjects}` })
          continue
        }
        const fileIds = preview.deployable.map(f => f.id)
        if (!fileIds.length) {
          results.push({ patchId, skipped: true, reason: 'Nothing deployable' })
          continue
        }
        const r = await executeDeploy({ patchId, fileIds, restartTomcat: false })
        results.push({ patchId, ...r })
      } catch (e) {
        results.push({ patchId, error: e.message })
      }
    }
    return results
  })

  // ---- Archive patches ----
  ipcMain.handle('patches:archive', async (_, { patchIds, destDir }) => {
    const fs   = require('fs')
    const path = require('path')
    const AdmZip = require('adm-zip')
    const db   = require('../db/schema').getDb()
    const results = []
    for (const patchId of patchIds) {
      try {
        const patch = db.prepare('SELECT * FROM patches WHERE id = ?').get(patchId)
        if (!patch || !patch.local_folder || !fs.existsSync(patch.local_folder)) {
          results.push({ patchId, error: 'Patch folder not found' }); continue
        }
        const app  = db.prepare('SELECT name FROM apps WHERE id = ?').get(patch.app_id)
        const date = (patch.email_date || '').slice(0, 10).replace(/-/g, '')
        const name = `${app?.name || 'patch'}_${date}_${patchId}.zip`
        const dest = path.join(destDir, name)
        const zip  = new AdmZip()
        zip.addLocalFolder(patch.local_folder)
        zip.writeZip(dest)
        results.push({ patchId, file: dest, success: true })
      } catch (e) {
        results.push({ patchId, error: e.message })
      }
    }
    return { results }
  })
}

module.exports = { registerHandlers }
