const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const log = require('./src/main/utils/logger')

process.on('uncaughtException', err => log.error('uncaughtException', err))
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason))

let mainWindow

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
  const distIndex = path.join(__dirname, 'dist', 'renderer', 'index.html')

  if (isDevMode) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(distIndex)
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
}

app.whenReady().then(() => {
  const { initializeDb } = require('./src/main/db/schema')
  initializeDb()
  log.info('DB initialized. Log file:', log.logFile)

  const { registerHandlers } = require('./src/main/ipc/handlers')
  registerHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
