const path = require('path')
const fs   = require('fs')
const { getDb }                        = require('../db/schema')
const { createPatch, createPatchFile } = require('../db/queries')
const { getEmails, saveAttachment }    = require('./outlookBridge')
const { classifyAttachment }           = require('./classifier')
const { extractDeploymentPaths }       = require('./pathParser')
const { createPatchFolder }            = require('../patches/organizer')
const { extract }                      = require('../patches/extractor')
const { logDeployment }                = require('../utils/logger')

// SQL keyword pattern — used to detect scripts in email body and text attachments
const SQL_KW = /\b(?:DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|SELECT\s+\*|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|EXECUTE|DECLARE|CALL)\b/i

function extractBodyScript(rawBody) {
  if (!rawBody || !SQL_KW.test(rawBody)) return null

  // Lines that start SQL statements
  const SQL_START = /^[ \t]*(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|SELECT\s+\*|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|EXECUTE|DECLARE|CALL)\b/i
  // Lines that clearly belong to email/signature/log — not SQL
  const NON_SQL = /^[ \t]*(?:(?:From|Sent|To|Cc|Subject|Date)[ \t]*:|(?:Regards|Thanks|Sincerely|Cheers|Best|Dear|Kindly)\b|\[(?:DEBUG|ERROR|INFO|WARN|TRACE)\]|at\s+[\w$.]+|[\w.]+(?:Exception|Error)\s*:|-----)/i

  const lines  = rawBody.split(/\r?\n/)
  const stmts  = []
  let current  = []
  let depth    = 0
  let inStmt   = false

  const flush = () => {
    if (current.length > 0) {
      const s = current.join('\n').trim()
      if (s && SQL_KW.test(s)) stmts.push(s)
    }
    current = []; inStmt = false; depth = 0
  }

  for (const raw of lines) {
    const trimmed = raw.trim()

    if (!inStmt) {
      if (SQL_START.test(trimmed)) {
        inStmt = true
        current = [trimmed]
        depth = Math.max(0, (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length)
        if (trimmed.endsWith(';') && depth === 0) flush()
      }
    } else {
      // Non-SQL marker at depth 0 ends the current statement
      if (depth === 0 && trimmed && NON_SQL.test(trimmed)) {
        flush()
        if (SQL_START.test(trimmed)) {
          inStmt = true; current = [trimmed]
          depth = Math.max(0, (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length)
          if (trimmed.endsWith(';') && depth === 0) flush()
        }
        continue
      }

      // Another SQL keyword at depth 0 also ends the current statement
      if (depth === 0 && trimmed && SQL_START.test(trimmed) && current.length > 0) {
        flush()
        inStmt = true; current = [trimmed]
        depth = Math.max(0, (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length)
        if (trimmed.endsWith(';') && depth === 0) flush()
        continue
      }

      current.push(trimmed)
      depth = Math.max(0, depth + (trimmed.match(/\(/g) || []).length - (trimmed.match(/\)/g) || []).length)
      if (trimmed.endsWith(';') && depth === 0) flush()
    }
  }

  flush()
  return stmts.length ? stmts.map(formatStatement).join('\n') : null
}

function hasSqlContent(text) {
  return SQL_KW.test(text || '')
}

// Collapse a multi-line SQL statement to a single line and ensure trailing ;
function formatStatement(stmt) {
  let s = stmt.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (s && !s.endsWith(';')) s += ';'
  return s
}

function extractTicketRef(subject) {
  const m = (subject || '').match(/\b([A-Z]{1,5}-\d+)\b/)
  return m ? m[1] : null
}

function regenerateCompiledScript(patchId, localFolder, email, db) {
  if (!localFolder || !fs.existsSync(localFolder)) return
  const compiledPath = path.join(localFolder, 'compiled_scripts.txt')

  // Delete old file and its DB record so we rewrite fresh
  try { fs.unlinkSync(compiledPath) } catch {}
  db.prepare(
    "DELETE FROM patch_files WHERE patch_id = ? AND original_filename = 'compiled_scripts.txt'"
  ).run(patchId)

  const scriptFiles = []

  // Re-extract from email body
  const bodyScript = extractBodyScript(email.body || '')
  if (bodyScript) scriptFiles.push({ filename: '(email body)', content: bodyScript })

  // Re-read existing SQL attachments already saved to disk
  const saved = db.prepare(
    "SELECT * FROM patch_files WHERE patch_id = ? AND file_type = 'db_script' AND original_filename != 'compiled_scripts.txt'"
  ).all(patchId)
  for (const pf of saved) {
    if (!pf.local_path) continue
    try {
      const content = fs.readFileSync(pf.local_path, 'utf8')
      if (hasSqlContent(content)) scriptFiles.push({ filename: pf.original_filename, content })
    } catch {}
  }

  if (!scriptFiles.length) return

  const header = `-- Compiled SQL Scripts\n-- Sources: ${scriptFiles.map(s => s.filename).join(', ')}\n-- Generated: ${new Date().toISOString()}\n\n`
  const sections = scriptFiles.map(sc => `-- ====== ${sc.filename} ======\n${sc.content}\n`)
  fs.writeFileSync(compiledPath, header + sections.join('\n'), 'utf8')
  createPatchFile({
    patch_id: patchId, original_filename: 'compiled_scripts.txt',
    local_path: compiledPath, file_type: 'db_script',
    deploy_status: 'skipped', merge_status: null, deploy_target_path: null
  })
}

function needsPath(fileType) {
  return fileType === 'jsp' || fileType === 'js_file' || fileType === 'xml_merge' || fileType === 'props_merge'
}

async function fetchForApp(app, sinceDate, toDate) {
  const db = getDb()
  let fetched  = 0
  const missingPaths = []

  // If patch_path is a UNC share, authenticate it before creating any folders
  if (app.patch_path && app.patch_path.startsWith('\\\\') && app.server_user && app.server_password) {
    const { spawnSync } = require('child_process')
    spawnSync('net', ['use', app.patch_path, `/user:${app.server_user}`, app.server_password], { stdio: 'pipe' })
  }

  let emails
  try {
    emails = await getEmails(app.outlook_folder_path, sinceDate, toDate)
  } catch (e) {
    throw new Error(`${app.name}: ${e.message}`)
  }

  for (const email of emails) {
    // Skip already-processed emails, but regenerate compiled_scripts.txt with latest logic
    if (email.entryId) {
      const dup = db.prepare(
        'SELECT id, local_folder FROM patches WHERE app_id = ? AND email_entry_id = ?'
      ).get(app.id, email.entryId)
      if (dup) {
        regenerateCompiledScript(dup.id, dup.local_folder, email, db)
        continue
      }
    }

    const atts = email.attachments || []
    if (!atts.length) continue

    // Pre-classify to skip emails that only have images / no actionable files
    const classified = atts
      .filter(a => a.filename)
      .map(a => ({ ...a, fileType: classifyAttachment(a.filename) }))
      .filter(a => a.fileType !== 'image')  // ignore images entirely

    if (!classified.length) continue

    const ticketRef   = extractTicketRef(email.subject)
    const localFolder = createPatchFolder(email.receivedTime, app.name, app.patch_path || null)
    const patchId     = createPatch({
      app_id:         app.id,
      email_entry_id: email.entryId || null,
      email_subject:  email.subject,
      email_sender:   email.sender,
      email_date:     email.receivedTime,
      email_folder:   app.outlook_folder_path,
      ticket_ref:     ticketRef,
      local_folder:   localFolder,
      status:         'staged',
      deployment_mode: app.deployment_mode
    })

    // { filename, savePath?, content? } — items to include in compiled_scripts.txt
    const scriptFiles = []

    // Check email body for SQL scripts first
    const bodyScript = extractBodyScript(email.body || '')
    if (bodyScript) {
      scriptFiles.push({ filename: '(email body)', content: bodyScript })
    }

    for (const att of classified) {
      const { fileType } = att
      const savePath = path.join(localFolder, att.filename)

      // Save attachment from Outlook
      try {
        await saveAttachment(email.entryId, att.index, savePath)
      } catch (e) {
        logDeployment({
          patchId, appId: app.id, action: 'save_attachment',
          status: 'failed', detail: `${att.filename}: ${e.message}`
        })
        continue
      }

      // For text/script attachments: extract and format SQL statements
      if (fileType === 'db_script') {
        let rawContent = ''
        try { rawContent = fs.readFileSync(savePath, 'utf8') } catch {}
        const extracted = extractBodyScript(rawContent)
        if (extracted) {
          scriptFiles.push({ filename: att.filename, savePath, content: extracted })
        } else {
          // Has no SQL — save as a reference so user can still see it
          createPatchFile({
            patch_id: patchId, original_filename: att.filename,
            local_path: savePath, file_type: 'reference',
            deploy_status: 'skipped', merge_status: null, deploy_target_path: null
          })
        }
        continue
      }

      // Extract GIAS archives
      if (fileType === 'gias_patch') {
        const extractDir = path.join(localFolder, 'extracted')
        try {
          await extract(savePath, extractDir)
          logDeployment({
            patchId, appId: app.id, action: 'extract',
            status: 'success', detail: `Extracted ${att.filename} → ${extractDir}`
          })
        } catch (e) {
          logDeployment({
            patchId, appId: app.id, action: 'extract',
            status: 'failed', detail: `${att.filename}: ${e.message}`
          })
        }
        createPatchFile({
          patch_id: patchId, original_filename: att.filename, local_path: savePath,
          file_type: fileType, deploy_status: 'pending', merge_status: null,
          deploy_target_path: null
        })
        continue
      }

      // Parse deployment path from email body
      const detectedPaths = extractDeploymentPaths(email.body || '')
      let deployPath  = null
      let confidence  = null
      if (detectedPaths.length > 0) {
        deployPath = detectedPaths[0].path
        confidence = detectedPaths[0].confidence
      }

      const deployStatus = fileType === 'reference' ? 'skipped' : 'pending'
      const mergeStatus  = (fileType === 'xml_merge' || fileType === 'props_merge') ? 'pending' : null

      const patchFileId = createPatchFile({
        patch_id:           patchId,
        original_filename:  att.filename,
        local_path:         savePath,
        file_type:          fileType,
        deploy_target_path: deployPath,
        merge_status:       mergeStatus,
        deploy_status:      deployStatus
      })

      if (needsPath(fileType) && (!deployPath || confidence === 'low')) {
        missingPaths.push({
          patchFileId, patchId, appId: app.id, appName: app.name,
          filename: att.filename, fileType, ticketRef,
          emailSubject: email.subject,
          emailBody:    (email.body || '').slice(0, 800).trim(),
          detectedPath: deployPath, confidence
        })
      }
    }

    // Compile all SQL sources (body + attachments) into compiled_scripts.txt
    if (scriptFiles.length > 0) {
      const compiledPath = path.join(localFolder, 'compiled_scripts.txt')
      const header = `-- Compiled SQL Scripts\n-- Sources: ${scriptFiles.map(s => s.filename).join(', ')}\n-- Generated: ${new Date().toISOString()}\n\n`
      const sections = scriptFiles.map(sc => {
        const content = sc.content !== undefined
          ? sc.content
          : (() => { try { return fs.readFileSync(sc.savePath, 'utf8') } catch { return '(could not read file)' } })()
        return `-- ====== ${sc.filename} ======\n${content}\n`
      })
      fs.writeFileSync(compiledPath, header + sections.join('\n'), 'utf8')
      createPatchFile({
        patch_id: patchId, original_filename: 'compiled_scripts.txt',
        local_path: compiledPath, file_type: 'db_script',
        deploy_status: 'skipped', merge_status: null, deploy_target_path: null
      })
    }

    fetched++
  }

  return { fetched, missingPaths }
}

async function fetchAll(appIds, sinceDate, allApps, toDate) {
  let totalFetched = 0
  let allMissing   = []
  const errors     = []

  for (const appId of appIds) {
    const app = allApps.find(a => a.id === appId)
    if (!app) continue
    try {
      const { fetched, missingPaths } = await fetchForApp(app, sinceDate, toDate)
      totalFetched += fetched
      allMissing    = allMissing.concat(missingPaths)
    } catch (e) {
      errors.push({ appId, appName: app.name, error: e.message })
    }
  }

  return { fetched: totalFetched, missingPaths: allMissing, errors }
}

module.exports = { fetchAll, fetchForApp }
