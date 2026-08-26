const { execFile } = require('child_process')
const path = require('path')

function getScriptsDir() {
  const { app } = require('electron')
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(__dirname, '../../scripts')
}

function runPs(scriptName, params = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(getScriptsDir(), scriptName)
    const args = [
      '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...params
    ]
    execFile('powershell.exe', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const errText = (stderr || '').trim()
      if (errText.includes('OUTLOOK_NOT_RUNNING')) {
        const e = new Error('Please open Microsoft Outlook and try again.')
        e.code = 'OUTLOOK_NOT_RUNNING'
        return reject(e)
      }
      if (errText.includes('STORE_NOT_FOUND')) {
        return reject(new Error('Outlook store not found. Verify the folder path includes the correct account name.'))
      }
      if (errText.includes('FOLDER_NOT_FOUND')) {
        const m = errText.match(/FOLDER_NOT_FOUND: (.+)/)
        return reject(new Error(`Outlook folder not found: ${m ? m[1] : ''}. Check the folder path in app settings.`))
      }
      if (err) return reject(new Error(errText || err.message))
      resolve(stdout.trim())
    })
  })
}

// Check if Outlook.exe is currently running
async function checkRunning() {
  return new Promise(resolve => {
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command',
      '$p = Get-Process outlook -ErrorAction SilentlyContinue; if ($p) { "RUNNING" } else { "NOT_RUNNING" }'
    ]
    execFile('powershell.exe', args, { timeout: 5000 }, (err, stdout) => {
      resolve(!err && stdout.trim() === 'RUNNING')
    })
  })
}

// Returns a flat array of { name, path, count, depth } for all MAPI stores
async function getFolders() {
  const json = await runPs('Get-OutlookFolders.ps1')
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

// Fetch emails from a folder. folderPath = "StoreName/Folder/Sub/..."
async function getEmails(folderPath, sinceDate, maxEmails = 100) {
  const json = await runPs('Get-OutlookEmails.ps1', [
    '-FolderPath', folderPath,
    '-SinceDate', sinceDate,
    '-MaxEmails', String(maxEmails)
  ])
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

// Save one attachment to disk
async function saveAttachment(entryId, attachmentIndex, savePath) {
  await runPs('Save-Attachment.ps1', [
    '-EntryId', entryId,
    '-AttachmentIndex', String(attachmentIndex),
    '-SavePath', savePath
  ])
}

module.exports = { checkRunning, getFolders, getEmails, saveAttachment }
