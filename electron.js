const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const log  = require('./src/main/utils/logger')

process.on('uncaughtException',   err    => log.error('uncaughtException', err))
process.on('unhandledRejection',  reason => log.error('unhandledRejection', reason))

let mainWindow
let tray
let isQuitting = false  // set true only on explicit Quit

// ---- Tray icon (16×16 PNG embedded as base64 for zero external file dependency) ----
// A simple blue "PM" monogram icon — replace resources/tray-icon.png for a custom one
function getTrayIcon() {
  const iconPath = path.join(__dirname, 'resources', 'tray-icon.png')
  const fs = require('fs')
  if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath)

  // Fallback: 16×16 solid blue square so the tray always has something
  const ico = path.join(__dirname, 'resources', 'icon.ico')
  if (fs.existsSync(ico)) return nativeImage.createFromPath(ico).resize({ width: 16, height: 16 })

  return nativeImage.createEmpty()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Show Patch Manager',
      click: () => { mainWindow.show(); mainWindow.focus() }
    },
    {
      label: 'Check for Updates',
      click: () => {
        mainWindow.show()
        const { checkNow } = require('./src/main/updater')
        checkNow(mainWindow)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { isQuitting = true; app.quit() }
    }
  ])
}

function createTray() {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('Patch Manager')
  tray.setContextMenu(buildTrayMenu())

  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'Patch Manager',
    show: false,
    backgroundColor: '#1e1e1e'
  })

  const isDevMode = !app.isPackaged && process.argv.includes('--dev')
  const distIndex  = path.join(__dirname, 'dist', 'renderer', 'index.html')

  if (isDevMode) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(distIndex)
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Minimize to tray instead of closing
  mainWindow.on('close', e => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
      tray.displayBalloon({
        iconType: 'info',
        title: 'Patch Manager',
        content: 'Running in the background. Double-click the tray icon to restore.'
      })
    }
  })
}

// ---- IPC: updater ----
function registerUpdaterIpc() {
  const { checkNow, downloadUpdate, installUpdate } = require('./src/main/updater')

  ipcMain.handle('updater:check',    () => checkNow(mainWindow))
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install',  () => installUpdate())
}

app.whenReady().then(() => {
  const { initializeDb } = require('./src/main/db/schema')
  initializeDb()
  log.info('DB initialized. Log file:', log.logFile)

  const { registerHandlers } = require('./src/main/ipc/handlers')
  registerHandlers()

  registerUpdaterIpc()
  createWindow()
  createTray()

  // Start the auto-updater (only in packaged builds — GitHub releases won't exist in dev)
  if (app.isPackaged) {
    const { setupUpdater } = require('./src/main/updater')
    setupUpdater(mainWindow)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => { isQuitting = true })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
