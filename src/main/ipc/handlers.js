const { ipcMain, dialog, shell, app } = require('electron')
const log = require('../utils/logger')
const {
  getAllSettings, saveSettings,
  getAllApps, saveApp, deleteApp,
  getPatchesForApp, getPatchById, getPatchFiles,
  updatePatch, updatePatchFile, getLogEntries, deletePatch
} = require('../db/queries')

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
  ipcMain.handle('outlook:fetch', async (_, { appIds, sinceDate }) => {
    log.info('outlook:fetch called', { appIds, sinceDate })
    try {
      const { fetchAll } = require('../email/fetchOrchestrator')
      const apps = getAllApps()
      const result = await fetchAll(appIds, sinceDate, apps)
      log.info('outlook:fetch done', result)
      return result
    } catch (e) {
      log.error('outlook:fetch failed', e)
      throw e
    }
  })

  // ---- Patch actions ----
  ipcMain.handle('patch:set-path', async (_, { patchFileId, deployPath }) => {
    updatePatchFile(patchFileId, { deploy_target_path: deployPath })
    return { success: true }
  })

  ipcMain.handle('patch:skip', async (_, { patchFileId }) => {
    updatePatchFile(patchFileId, { deploy_status: 'skipped' })
    return { success: true }
  })

  // ---- Phase 4: Merge engine ----
  ipcMain.handle('merge:preview', async (_, { patchFileId }) => {
    const { previewMerge } = require('../merge/mergeEngine')
    return previewMerge(patchFileId)
  })

  ipcMain.handle('merge:apply', async (_, { patchFileId, mergedContent }) => {
    const { applyMerge } = require('../merge/mergeEngine')
    return applyMerge(patchFileId, mergedContent)
  })

  // ---- Patch delete ----
  ipcMain.handle('patch:delete', async (_, { patchId }) => {
    const patch = getPatchById(patchId)
    if (!patch) return { success: false, error: 'Patch not found' }
    if (patch.status !== 'staged') {
      return { success: false, error: `Only staged patches can be deleted (current status: ${patch.status})` }
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

  // ---- Phase 5: Deployment engine ----
  ipcMain.handle('deploy:preview', async (_, { patchId }) => {
    const { previewDeploy } = require('../deploy/deployEngine')
    return previewDeploy(patchId)
  })

  ipcMain.handle('deploy:execute', async (_, { patchId, fileIds, restartTomcat }) => {
    const { executeDeploy } = require('../deploy/deployEngine')
    return executeDeploy({ patchId, fileIds, restartTomcat })
  })

  ipcMain.handle('deploy:mark-manual', async (_, { patchId, fileIds }) => {
    const { markManual } = require('../deploy/deployEngine')
    return markManual({ patchId, fileIds })
  })

  // ---- WAR deploy ----
  ipcMain.handle('war:deploy', async (event, { appId }) => {
    const { buildWar, deployWarSFTP } = require('../deploy/warEngine')
    const app = getAllApps().find(a => a.id === appId)
    if (!app) return { success: false, error: 'App not found' }
    if (!app.local_src_path) return { success: false, error: 'local_src_path not configured' }
    if (!app.war_name)       return { success: false, error: 'war_name not configured' }
    if (!app.remote_war_path) return { success: false, error: 'remote_war_path not configured' }

    const steps = []
    try {
      steps.push('Building WAR from local source…')
      event.sender.send('war:progress', { step: steps[steps.length - 1] })
      const localWar = buildWar(app.local_src_path, app.war_name)
      steps.push(`WAR built: ${localWar}`)
      event.sender.send('war:progress', { step: steps[steps.length - 1] })

      await deployWarSFTP(app, localWar, msg => {
        steps.push(msg)
        event.sender.send('war:progress', { step: msg })
      })

      try { require('fs').unlinkSync(localWar) } catch {}
      log.info('war:deploy success', { appId, steps })
      return { success: true, steps }
    } catch (e) {
      log.error('war:deploy failed', e)
      return { success: false, error: e.message, steps }
    }
  })

  // ---- Tomcat restart ----
  ipcMain.handle('tomcat:restart', async (_, { appId }) => {
    const { restartTomcatSSH } = require('../deploy/warEngine')
    const app = getAllApps().find(a => a.id === appId)
    if (!app) return { success: false, error: 'App not found' }
    try {
      const out = await restartTomcatSSH(app)
      log.info('tomcat:restart success', { appId, out })
      return { success: true, output: out }
    } catch (e) {
      log.error('tomcat:restart failed', e)
      return { success: false, error: e.message }
    }
  })

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
        const preview = previewDeploy(patchId)
        if (preview.blockedBy && preview.blockedBy.length > 0) {
          results.push({ patchId, error: `${preview.blockedBy.length} older patch(es) must be deployed first` })
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
}

module.exports = { registerHandlers }
