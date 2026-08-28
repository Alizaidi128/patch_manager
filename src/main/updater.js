const { autoUpdater } = require('electron-updater')
const log = require('./utils/logger')

autoUpdater.logger = log
autoUpdater.autoDownload = false        // ask user first
autoUpdater.autoInstallOnAppQuit = false

function setupUpdater(mainWindow) {
  function send(event, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:' + event, payload)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Checking for update…')
  })

  autoUpdater.on('update-available', info => {
    log.info('[updater] Update available', info)
    send('available', { version: info.version, releaseNotes: info.releaseNotes })
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] Up to date')
    send('not-available', {})
  })

  autoUpdater.on('download-progress', progress => {
    send('progress', { percent: Math.round(progress.percent), bytesPerSecond: progress.bytesPerSecond })
  })

  autoUpdater.on('update-downloaded', info => {
    log.info('[updater] Update downloaded', info)
    send('downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err, message) => {
    log.error('[updater] Error', err)
    // Silently swallow background check failures (no published release yet, network issues, etc.)
    // Only surface errors that happen during an active download
    if (autoUpdater.downloadingUpdateInfo) {
      send('error', { message: 'Download failed — check your connection and try again.' })
    }
  })

  // Check on startup after a short delay (let the app fully load first)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => log.warn('[updater] check failed', e.message))
  }, 5000)
}

function checkNow(mainWindow) {
  const send = (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:' + event, payload)
  }
  send('checking', {})
  autoUpdater.checkForUpdates().catch(e => {
    log.warn('[updater] manual check failed', e.message)
    send('error', { message: 'Could not reach update server. Check your connection or try again later.' })
  })
}

function downloadUpdate() {
  return autoUpdater.downloadUpdate()
}

function installUpdate() {
  autoUpdater.quitAndInstall(false, true)
}

module.exports = { setupUpdater, checkNow, downloadUpdate, installUpdate }
