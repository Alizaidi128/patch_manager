const fs   = require('fs')
const path = require('path')
const log  = require('../utils/logger')
const { getDb } = require('../db/schema')
const { resolveFilePath } = require('../merge/mergeEngine')
const { previewMerge: propsPreview } = require('../merge/propsMerge')
const { previewMerge: xmlPreview }   = require('../merge/xmlMerge')
const { getPatchRootDir } = require('../patches/organizer')

const STRUCTURAL_DIRS = /^(WEB-INF|META-INF|genins|classes|lib|webapps|src|resources|static|templates)$/i

// Extensions that are never deployed to an app server — skip when walking extracted dirs
const NON_DEPLOY_EXTS = new Set(['.rar', '.zip', '.7z', '.tar', '.gz', '.sql', '.txt', '.log', '.bak', '.md'])

function walkDir(dir, deployRoot, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walkDir(full, deployRoot, acc)
    } else {
      // At the root level of the extracted folder, skip archive/script files — they are
      // source artifacts (the RAR itself, SQL scripts, notes) not actual app deployment files.
      if (dir === deployRoot && NON_DEPLOY_EXTS.has(path.extname(e.name).toLowerCase())) continue
      acc.push(full)
    }
  }
  return acc
}

function giasDeployRoot(extractedDir) {
  try {
    const entries = fs.readdirSync(extractedDir, { withFileTypes: true })
    if (entries.length === 1 && entries[0].isDirectory() && !STRUCTURAL_DIRS.test(entries[0].name)) {
      return path.join(extractedDir, entries[0].name)
    }
  } catch {}
  return extractedDir
}

// Smart search for where a GIAS archive was extracted.
// Tries: {rarBaseName}/ (new standard), extracted/ (legacy), then baseDir itself
// (covers the case where the user extracted directly into the seq folder via WinRAR).
function findExtractedDir(localPath) {
  const baseDir    = path.dirname(localPath)
  const rarBaseName = path.basename(localPath, path.extname(localPath))

  const namedDir  = path.join(baseDir, rarBaseName)
  if (fs.existsSync(namedDir) && fs.statSync(namedDir).isDirectory()) return namedDir

  const legacyDir = path.join(baseDir, 'extracted')
  if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) return legacyDir

  // If the seq folder itself contains subdirectories, the RAR was extracted in-place
  try {
    const hasSubDirs = fs.readdirSync(baseDir, { withFileTypes: true }).some(e => e.isDirectory())
    if (hasSubDirs) return baseDir
  } catch {}

  return null
}

function localDeployRoot(app) {
  if (app.deployment_mode === 'sftp') return app.local_src_path || app.app_root_path
  return app.smb_path || app.app_root_path
}

function fmtDate(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '')
}

function checkGias(file, app) {
  const deployRoot = localDeployRoot(app)
  if (!deployRoot)    return { status: 'unknown', detail: 'No deploy root configured for this app' }
  if (!file.local_path) return { status: 'unknown', detail: 'No local file path recorded' }

  const extractedDir = findExtractedDir(file.local_path)
  if (!extractedDir) return { status: 'unknown', detail: 'Extracted archive not found — deploy once to extract' }

  const dRoot    = giasDeployRoot(extractedDir)
  const srcFiles = walkDir(dRoot, dRoot)
  if (!srcFiles.length) return { status: 'unknown', detail: 'Extracted archive is empty' }

  const pendingFiles = []
  const newerInApp   = []

  for (const src of srcFiles) {
    const rel  = path.relative(dRoot, src)
    const dest = path.join(deployRoot, rel)
    if (!fs.existsSync(dest)) {
      pendingFiles.push(rel)
    } else {
      const sm = fs.statSync(src).mtimeMs
      const dm = fs.statSync(dest).mtimeMs
      if (sm > dm) pendingFiles.push(rel)
      else if (dm > sm) newerInApp.push(rel)
    }
  }

  if (!pendingFiles.length) {
    return {
      status: 'deployed',
      detail: `All ${srcFiles.length} file${srcFiles.length !== 1 ? 's' : ''} are up to date`,
      newerInApp: newerInApp.length ? newerInApp : undefined
    }
  }
  return {
    status: 'pending',
    detail: `${pendingFiles.length} of ${srcFiles.length} file${srcFiles.length !== 1 ? 's' : ''} not yet applied`,
    pendingFiles: pendingFiles.slice(0, 30)
  }
}

function checkMtime(file) {
  if (!file.deploy_target_path) return { status: 'unknown', detail: 'No deployment path set' }
  if (!file.local_path || !fs.existsSync(file.local_path)) return { status: 'unknown', detail: 'Patch file not found on disk' }

  const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
  if (!fs.existsSync(resolvedPath)) {
    return { status: 'pending', detail: 'File not found in app directory', resolvedPath }
  }

  const pm = fs.statSync(file.local_path).mtimeMs
  const am = fs.statSync(resolvedPath).mtimeMs

  if (am >= pm) {
    return { status: 'deployed', detail: `App: ${fmtDate(am)} · Patch: ${fmtDate(pm)}`, resolvedPath }
  }
  return { status: 'pending', detail: `Patch is newer — App: ${fmtDate(am)} · Patch: ${fmtDate(pm)}`, resolvedPath }
}

function checkPropsMerge(file) {
  if (!file.deploy_target_path) return { status: 'unknown', detail: 'No deployment path set' }
  if (!file.local_path || !fs.existsSync(file.local_path)) return { status: 'unknown', detail: 'Patch file not found on disk' }

  try {
    const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
    if (!fs.existsSync(resolvedPath)) {
      return { status: 'pending', detail: 'File not found in app directory', resolvedPath }
    }
    const snippet  = fs.readFileSync(file.local_path, 'utf8').trim()
    if (!snippet) return { status: 'deployed', detail: 'Patch file is empty — nothing to check', resolvedPath }

    const existing = fs.readFileSync(resolvedPath, 'utf8')
    const { toAdd } = propsPreview(existing, snippet)

    if (!toAdd.length) {
      return { status: 'deployed', detail: 'All properties already present', resolvedPath }
    }
    return { status: 'pending', detail: `${toAdd.length} missing propert${toAdd.length === 1 ? 'y' : 'ies'}`, missingKeys: toAdd.map(e => e.key), resolvedPath }
  } catch (e) {
    return { status: 'error', detail: e.message }
  }
}

function checkXmlMerge(file) {
  if (!file.deploy_target_path) return { status: 'unknown', detail: 'No deployment path set' }
  if (!file.local_path || !fs.existsSync(file.local_path)) return { status: 'unknown', detail: 'Patch file not found on disk' }

  try {
    const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
    if (!fs.existsSync(resolvedPath)) {
      return { status: 'pending', detail: 'File not found in app directory', resolvedPath }
    }
    const snippet  = fs.readFileSync(file.local_path, 'utf8').trim()
    const existing = fs.readFileSync(resolvedPath, 'utf8')
    const { toAdd } = xmlPreview(existing, snippet)

    const total = (toAdd.servlets?.length || 0) + (toAdd.mappings?.length || 0)
    if (!total) {
      return { status: 'deployed', detail: 'All servlet/mapping entries present', resolvedPath }
    }
    return {
      status: 'pending',
      detail: `${total} missing entr${total === 1 ? 'y' : 'ies'} in web.xml`,
      missingServlets: toAdd.servlets?.map(s => s.name) || [],
      missingMappings: toAdd.mappings?.map(s => s.name) || [],
      resolvedPath
    }
  } catch (e) {
    return { status: 'error', detail: e.message }
  }
}

// Scan the app's patch directory for sequence folders not registered in the DB.
// Covers patches the user manually copied in or fetched before this detection feature existed.
function detectUntrackedPatches(app) {
  const db = getDb()
  try {
    // Derive folder name the same way createPatchFolder does — Outlook folder leaf, fall back to app name
    const outlookLeaf  = (app.outlook_folder_path ? path.basename(app.outlook_folder_path) : '').trim()
    const folderSource = outlookLeaf || app.name || 'UNKNOWN'
    const safeFolder   = folderSource.replace(/[\\/:*?"<>|]/g, '_').trim() || 'UNKNOWN'
    const root         = app.patch_path || getPatchRootDir()
    const appPatchDir  = path.join(root, safeFolder)

    // Also try the legacy app-name folder (if outlook folder name differs from app name)
    const safeApp     = (app.name || 'UNKNOWN').replace(/[\\/:*?"<>|]/g, '_').trim() || 'UNKNOWN'
    const legacyDir   = safeFolder !== safeApp ? path.join(root, safeApp) : null
    const scanDirs = [appPatchDir]
    if (legacyDir && fs.existsSync(legacyDir)) scanDirs.push(legacyDir)
    if (!fs.existsSync(appPatchDir) && !scanDirs.some(d => fs.existsSync(d))) return []

    const untracked = []
    const allDateEntries = []
    for (const scanDir of scanDirs) {
      if (!fs.existsSync(scanDir)) continue
      const entries = fs.readdirSync(scanDir, { withFileTypes: true }).filter(e => e.isDirectory())
      allDateEntries.push(...entries.map(e => ({ ...e, basePath: scanDir })))
    }
    const dateDirs = allDateEntries

    for (const dateEntry of dateDirs) {
      const dateDir = path.join(dateEntry.basePath || appPatchDir, dateEntry.name)
      const seqDirs = fs.readdirSync(dateDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d+$/.test(e.name))

      for (const seqEntry of seqDirs) {
        const seqDir = path.join(dateDir, seqEntry.name)

        // Skip if this folder is already tracked in the DB
        const tracked = db.prepare('SELECT id FROM patches WHERE local_folder = ?').get(seqDir)
        if (tracked) continue

        // Scan for archive files (GIAS RARs / ZIPs)
        let entries
        try { entries = fs.readdirSync(seqDir) } catch { continue }

        const archives = entries.filter(e =>
          /\.(rar|zip)$/i.test(e) && !e.startsWith('.')
        )
        if (!archives.length) continue

        const fileResults = []
        for (const archiveName of archives) {
          const fakeFile = {
            local_path: path.join(seqDir, archiveName),
            file_type:  'gias_patch',
          }
          const check = checkGias(fakeFile, app)
          fileResults.push({
            fileId:   `untracked_${seqDir}_${archiveName}`,
            filename: archiveName,
            fileType: 'gias_patch',
            isUntracked: true,
            ...check
          })
        }

        const checkable = fileResults.filter(f => f.status !== 'not-applicable')
        const detectedStatus =
          !checkable.length                                    ? 'unknown'
          : checkable.every(f => f.status === 'deployed')     ? 'deployed'
          : checkable.some(f => f.status === 'pending')       ? 'pending'
          : 'unknown'

        untracked.push({
          patchId:        `untracked_${seqDir}`,
          subject:        `${dateEntry.name} / ${seqEntry.name}`,
          emailDate:      null,
          patchStatus:    'untracked',
          isUntracked:    true,
          detectedStatus,
          files:          fileResults
        })
      }
    }

    return untracked
  } catch { return [] }
}

function detectAllStatus(appId) {
  const db  = getDb()
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId)
  if (!app) throw new Error(`App ${appId} not found`)

  log.info(`[detect] Starting status check for app "${app.name}" (id=${appId})`)
  log.info(`[detect] Deploy root: ${localDeployRoot(app) || '(not configured)'}`)

  const patches = db.prepare(
    `SELECT * FROM patches WHERE app_id = ? ORDER BY email_date ASC, id ASC`
  ).all(appId)
  log.info(`[detect] ${patches.length} patch(es) found in DB`)

  const results = []

  for (const patch of patches) {
    const files = db.prepare('SELECT * FROM patch_files WHERE patch_id = ? ORDER BY id').all(patch.id)
    const fileResults = []
    log.info(`[detect] Patch #${patch.id} "${(patch.email_subject || '').slice(0, 60)}" — ${files.length} file(s)`)

    for (const file of files) {
      let check
      switch (file.file_type) {
        case 'gias_patch':   check = checkGias(file, app); break
        case 'props_merge':  check = checkPropsMerge(file); break
        case 'xml_merge':    check = checkXmlMerge(file); break
        case 'jsp':
        case 'js_file':      check = checkMtime(file); break
        case 'db_script':    check = { status: 'not-applicable', detail: 'Applied manually by DBA' }; break
        case 'reference':    check = { status: 'not-applicable', detail: 'Reference document' }; break
        default:             check = { status: 'unknown', detail: 'Cannot check this file type' }
      }

      log.info(`[detect]   ${file.file_type.padEnd(12)} ${file.original_filename.padEnd(40)} → ${check.status.toUpperCase()} | ${check.detail || ''}`)

      fileResults.push({
        fileId:           file.id,
        filename:         file.original_filename,
        fileType:         file.file_type,
        deployTargetPath: file.deploy_target_path,
        dbDeployStatus:   file.deploy_status,
        dbMergeStatus:    file.merge_status,
        ...check
      })
    }

    const checkable = fileResults.filter(f => f.status !== 'not-applicable')
    const detectedStatus =
      !checkable.length                              ? 'not-applicable'
      : checkable.every(f => f.status === 'deployed') ? 'deployed'
      : checkable.some(f => f.status === 'pending' || f.status === 'error') ? 'pending'
      : 'unknown'

    results.push({
      patchId:        patch.id,
      subject:        patch.email_subject,
      emailDate:      patch.email_date,
      patchStatus:    patch.status,
      detectedStatus,
      files:          fileResults
    })
  }

  // Append any untracked local patch folders not in the DB
  const untracked = detectUntrackedPatches(app)
  if (untracked.length) log.info(`[detect] ${untracked.length} untracked folder(s) found on disk`)
  results.push(...untracked)

  const deployed = results.filter(r => r.detectedStatus === 'deployed').length
  const pending  = results.filter(r => r.detectedStatus === 'pending').length
  log.info(`[detect] Done — ${results.length} total: ${deployed} deployed, ${pending} pending`)

  return { appId, appName: app.name, results }
}

module.exports = { detectAllStatus }
