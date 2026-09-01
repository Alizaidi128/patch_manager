const { execFile } = require('child_process')
const path = require('path')
const fs   = require('fs')
const log  = require('../utils/logger')

// 64-bit PS first; fall back to 32-bit if COM can't reach a 32-bit Outlook
const PS_PATHS = [
  'powershell.exe',
  'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
]

function getScriptsDir() {
  const { app } = require('electron')
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(__dirname, '../../scripts')
}

function runPsExe(psExe, scriptName, params) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(getScriptsDir(), scriptName)
    const args = [
      '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...params
    ]
    execFile(psExe, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
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

// Try 64-bit PS; if Outlook COM fails (bitness mismatch) retry with 32-bit PS
async function runPs(scriptName, params = []) {
  const candidates = PS_PATHS.filter((p, i) => i === 0 || fs.existsSync(p))
  let lastErr
  for (const psExe of candidates) {
    log.info(`[outlook] Running ${scriptName} via ${psExe}`)
    try {
      const result = await runPsExe(psExe, scriptName, params)
      log.info(`[outlook] ${scriptName} succeeded via ${path.basename(psExe)}`)
      return result
    } catch (e) {
      lastErr = e
      if (e.code !== 'OUTLOOK_NOT_RUNNING') throw e  // folder/store errors — don't retry
      log.warn(`[outlook] ${path.basename(psExe)} → OUTLOOK_NOT_RUNNING, ${candidates.length > 1 ? 'retrying with 32-bit PS' : 'no more candidates'}`)
    }
  }
  throw lastErr
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
async function getEmails(folderPath, sinceDate, toDate, maxEmails = 100) {
  log.info(`[outlook] getEmails folder="${folderPath}"  since=${sinceDate}  to=${toDate || '(none)'}  max=${maxEmails}`)
  const args = ['-FolderPath', folderPath, '-SinceDate', sinceDate, '-MaxEmails', String(maxEmails)]
  if (toDate) args.push('-ToDate', toDate)
  const json = await runPs('Get-OutlookEmails.ps1', args)
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    const emails = Array.isArray(parsed) ? parsed : [parsed]
    log.info(`[outlook] getEmails returned ${emails.length} email(s)`)
    return emails
  } catch {
    log.error('[outlook] getEmails — failed to parse PS JSON output')
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
