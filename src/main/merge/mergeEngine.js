const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { getDb }          = require('../db/schema')
const { updatePatchFile } = require('../db/queries')
const { logDeployment }  = require('../utils/logger')
const { previewMerge: xmlPreview, applyMerge: xmlApply }       = require('./xmlMerge')
const { previewMerge: propsPreview, applyMerge: propsApply }   = require('./propsMerge')

// ---- Internal helpers ----

function getFileWithContext(patchFileId) {
  const db    = getDb()
  const file  = db.prepare('SELECT * FROM patch_files WHERE id = ?').get(patchFileId)
  if (!file) throw new Error(`Patch file ${patchFileId} not found`)
  const patch = db.prepare('SELECT * FROM patches WHERE id = ?').get(file.patch_id)
  const app   = db.prepare('SELECT * FROM apps WHERE id = ?').get(patch.app_id)
  return { file, patch, app }
}

function sftpOpts(app) {
  const opts = {
    host: app.server_host,
    port: app.server_port || 22,
    username: app.server_user,
    readyTimeout: 15000,
    retries: 0
  }
  if (app.server_key_path) {
    opts.privateKey = fs.readFileSync(app.server_key_path)
  } else {
    opts.password = app.server_password
  }
  return opts
}

// Returns true for local Windows paths (C:\...) and UNC paths (\\server\...)
function isLocalPath(p) {
  return /^[A-Za-z]:[\\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('//')
}

async function readFromServer(app, filePath) {
  // Local or UNC path — read directly regardless of deployment mode
  if (isLocalPath(filePath) || app.deployment_mode === 'smb' || app.deployment_mode === 'rdp_assisted') {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
    return fs.readFileSync(filePath, 'utf8')
  }

  if (app.deployment_mode === 'sftp') {
    const SftpClient = require('ssh2-sftp-client')
    const sftp = new SftpClient()
    const tmp  = path.join(os.tmpdir(), `pm_read_${Date.now()}`)
    try {
      await sftp.connect(sftpOpts(app))
      await sftp.fastGet(filePath, tmp)
      await sftp.end()
      const content = fs.readFileSync(tmp, 'utf8')
      try { fs.unlinkSync(tmp) } catch {}
      return content
    } catch (e) {
      try { await sftp.end() } catch {}
      throw e
    }
  }

  throw new Error(`Merge is not available for deployment mode: ${app.deployment_mode}`)
}

async function writeToServer(app, filePath, content) {
  // Hard safety gate: never write null/undefined/empty content — this would wipe the server file
  if (content == null || String(content).trim().length === 0) {
    throw new Error('Safety check failed: merged content is empty. Write aborted to protect the server file.')
  }

  const ts = Date.now()

  // Local or UNC path — write directly regardless of deployment mode
  if (isLocalPath(filePath) || app.deployment_mode === 'smb' || app.deployment_mode === 'rdp_assisted') {
    const bak = `${filePath}.bak-${ts}`
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf8')
    return bak
  }

  if (app.deployment_mode === 'sftp') {
    const SftpClient = require('ssh2-sftp-client')
    const sftp = new SftpClient()
    const tmp  = path.join(os.tmpdir(), `pm_write_${ts}`)
    fs.writeFileSync(tmp, content, 'utf8')
    try {
      await sftp.connect(sftpOpts(app))
      const bak = `${filePath}.bak-${ts}`
      try { await sftp.rename(filePath, bak) } catch {}
      await sftp.fastPut(tmp, filePath)
      await sftp.end()
      try { fs.unlinkSync(tmp) } catch {}
    } catch (e) {
      try { await sftp.end() } catch {}
      try { fs.unlinkSync(tmp) } catch {}
      throw e
    }
  }
}

function commonPrefixLen(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

// If the stored deploy_target_path is a directory, append the original filename.
// When the exact name isn't found, searches the directory for the closest match.
// Handles cross-extension cases: label.txt / labels.txt → LabelsBundle.properties
function resolveFilePath(deployTargetPath, originalFilename) {
  const cleanPath = (deployTargetPath || '').trim()

  // If path already has a file extension treat it as a full file path
  if (path.extname(cleanPath)) return cleanPath

  // Path is a directory — append the filename
  const exact = path.join(cleanPath, originalFilename)
  if (fs.existsSync(exact)) return exact

  // Exact name not found — search directory for best match
  try {
    if (!fs.existsSync(cleanPath) || !fs.statSync(cleanPath).isDirectory()) return exact
    const targetExt  = path.extname(originalFilename).toLowerCase()
    const targetBase = path.basename(originalFilename, path.extname(originalFilename)).toLowerCase()
    const entries    = fs.readdirSync(cleanPath)

    // 1. Case-insensitive exact match
    const caseMatch = entries.find(e => e.toLowerCase() === originalFilename.toLowerCase())
    if (caseMatch) return path.join(cleanPath, caseMatch)

    // Normalize a base name for scoring: strip common plural/suffix variants
    // e.g. 'labels' → 'label', 'labelsbundle' keeps as-is (stripped only trailing lone 's')
    function normalizeBase(b) {
      // Only strip trailing 's' if the result is still ≥4 chars and it was a lone plural
      // ('labels' → 'label', but 'class' stays 'class')
      return (b.length > 4 && b.endsWith('s') && !b.endsWith('ss')) ? b.slice(0, -1) : b
    }

    // Score a candidate entry against the target base (both lowercased, no extension).
    // Returns a numeric score; higher = better match.
    function score(candidateBase) {
      const normTarget    = normalizeBase(targetBase)
      const normCandidate = normalizeBase(candidateBase)
      const prefix = commonPrefixLen(normTarget, normCandidate)
      const diff   = Math.abs(normTarget.length - normCandidate.length)
      return prefix * 100 - diff
    }

    // Build candidate pool: prefer same-extension entries, then fall back to .properties/.txt
    // cross-extension (covers label.txt → LabelsBundle.properties and vice-versa)
    const LABEL_EXTS = new Set(['.properties', '.txt', '.xml'])
    const sameExt  = entries.filter(e => path.extname(e).toLowerCase() === targetExt)
    const crossExt = (LABEL_EXTS.has(targetExt))
      ? entries.filter(e => {
          const ext = path.extname(e).toLowerCase()
          return ext !== targetExt && LABEL_EXTS.has(ext)
        })
      : []

    function bestScoredMatch(pool) {
      if (pool.length === 1) return pool[0]
      let best = null, bestSc = -1
      for (const e of pool) {
        const sc = score(path.basename(e, path.extname(e)).toLowerCase())
        if (sc > bestSc) { bestSc = sc; best = e }
      }
      return bestSc >= 400 ? best : null
    }

    const m = bestScoredMatch(sameExt) || bestScoredMatch(crossExt)
    if (m) return path.join(cleanPath, m)
  } catch {}

  return exact  // Will produce a clear "File not found" error with the resolved path
}

// ---- Public API ----

async function previewMerge(patchFileId) {
  const { file, app } = getFileWithContext(patchFileId)

  if (!file.deploy_target_path)
    throw new Error('No deployment path set for this file. Set a path first.')
  if (!file.local_path || !fs.existsSync(file.local_path))
    throw new Error(`Local patch file not found: ${file.local_path}`)

  const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
  const snippet  = fs.readFileSync(file.local_path, 'utf8')

  // Block merge if the patch file is empty — merging nothing risks wiping the server file
  if (!snippet || snippet.trim().length === 0) {
    throw new Error(
      `The patch file "${file.original_filename}" is empty — there is nothing to merge.\n` +
      `No changes have been made to the server file.`
    )
  }

  const existing = await readFromServer(app, resolvedPath)

  // Sanity-check that we successfully read the server file
  if (!existing || existing.trim().length === 0) {
    throw new Error(
      `Server file "${path.basename(resolvedPath)}" appears to be empty or could not be read.\n` +
      `Merge aborted to avoid overwriting. Check the file at: ${resolvedPath}`
    )
  }

  let preview, mergedContent
  if (file.file_type === 'xml_merge') {
    preview       = xmlPreview(existing, snippet)
    mergedContent = xmlApply(existing, snippet)
  } else if (file.file_type === 'props_merge') {
    preview       = propsPreview(existing, snippet)
    mergedContent = propsApply(existing, snippet)
  } else {
    throw new Error(`Merge not supported for file type: ${file.file_type}`)
  }

  // Validate the merge result isn't dramatically smaller than the existing file
  if (mergedContent.length < existing.length * 0.5) {
    throw new Error(
      `Merge safety check failed: result (${mergedContent.length} chars) is less than half the size ` +
      `of the existing file (${existing.length} chars). Merge aborted.`
    )
  }

  return {
    ...preview,
    mergedContent,
    fileType:    file.file_type,
    filename:    file.original_filename,
    deployPath:  resolvedPath,
    hasChanges:  (preview.toAdd?.length ?? 0) > 0 ||
                 (preview.toAdd?.servlets?.length ?? 0) + (preview.toAdd?.mappings?.length ?? 0) > 0
  }
}

async function applyMerge(patchFileId, mergedContent) {
  const { file, patch, app } = getFileWithContext(patchFileId)

  // Re-validate content from the frontend before touching disk
  if (mergedContent == null || String(mergedContent).trim().length === 0) {
    throw new Error('Apply aborted: merged content received from UI is empty. No changes were made.')
  }

  // Re-read the existing file to confirm the merge result isn't smaller
  const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
  const existing = await readFromServer(app, resolvedPath)
  if (existing && mergedContent.length < existing.length * 0.5) {
    throw new Error(
      `Apply aborted: merged result (${mergedContent.length} chars) is less than half the current ` +
      `server file size (${existing.length} chars). No changes were made.`
    )
  }

  await writeToServer(app, resolvedPath, mergedContent)

  updatePatchFile(patchFileId, { merge_status: 'merged', deploy_status: 'deployed' })

  logDeployment({
    patchId:     patch.id,
    patchFileId,
    appId:       patch.app_id,
    action:      'merge',
    status:      'success',
    detail:      `Merged ${file.original_filename} → ${resolvedPath}`
  })

  return { success: true }
}

module.exports = { previewMerge, applyMerge, resolveFilePath }
