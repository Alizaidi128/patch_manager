const { ipcMain, dialog, shell, app } = require('electron')
const {
  getAllSettings, saveSettings,
  getAllApps, saveApp, deleteApp,
  getPatchesForApp, updatePatch, updatePatchFile, getLogEntries
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
    const { fetchAll } = require('../email/fetchOrchestrator')
    const apps = getAllApps()
    return fetchAll(appIds, sinceDate, apps)
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
}

module.exports = { registerHandlers }
