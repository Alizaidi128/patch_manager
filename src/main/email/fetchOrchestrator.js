const path = require('path')
const fs   = require('fs')
const { getDb }           = require('../db/schema')
const { createPatch, createPatchFile, getAllSettings } = require('../db/queries')
const { getEmails, saveAttachment } = require('./outlookBridge')
const { classifyAttachment }        = require('./classifier')
const { extractDeploymentPaths }    = require('./pathParser')
const { createPatchFolder }         = require('../patches/organizer')
const { extract }                   = require('../patches/extractor')
const { logDeployment }             = require('../utils/logger')

function extractTicketRef(subject) {
  const m = (subject || '').match(/\b([A-Z]{1,5}-\d+)\b/)
  return m ? m[1] : null
}

// Returns true if a JSP/merge file genuinely needs a deploy path
function needsPath(fileType) {
  return fileType === 'jsp' || fileType === 'xml_merge' || fileType === 'props_merge'
}

async function fetchForApp(app, sinceDate) {
  const db = getDb()
  let fetched  = 0
  const missingPaths = []

  let emails
  try {
    emails = await getEmails(app.outlook_folder_path, sinceDate)
  } catch (e) {
    throw new Error(`${app.name}: ${e.message}`)
  }

  for (const email of emails) {
    // Skip already-processed emails (idempotent)
    if (email.entryId) {
      const dup = db.prepare(
        'SELECT id FROM patches WHERE app_id = ? AND email_entry_id = ?'
      ).get(app.id, email.entryId)
      if (dup) continue
    }

    // Skip emails with no actionable attachments
    const atts = email.attachments || []
    if (!atts.length) continue

    const ticketRef  = extractTicketRef(email.subject)
    const localFolder = createPatchFolder()
    const patchId = createPatch({
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

    for (const att of atts) {
      if (!att.filename) continue

      const fileType = classifyAttachment(att.filename)
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

      // Extract GIAS archives into extracted\ subfolder
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
      }

      // Parse deployment path from email body
      const paths = extractDeploymentPaths(email.body || '')
      let deployPath = null
      let confidence = null
      if (paths.length > 0) {
        deployPath = paths[0].path
        confidence = paths[0].confidence
      }

      const deployStatus = (fileType === 'db_script' || fileType === 'reference')
        ? 'skipped' : 'pending'
      const mergeStatus = (fileType === 'xml_merge' || fileType === 'props_merge')
        ? 'pending' : null

      const patchFileId = createPatchFile({
        patch_id:          patchId,
        original_filename: att.filename,
        local_path:        savePath,
        file_type:         fileType,
        deploy_target_path: deployPath,
        merge_status:      mergeStatus,
        deploy_status:     deployStatus
      })

      // Collect files where path is missing or only low-confidence
      if (needsPath(fileType) && (!deployPath || confidence === 'low')) {
        missingPaths.push({
          patchFileId,
          patchId,
          appId:        app.id,
          appName:      app.name,
          filename:     att.filename,
          fileType,
          ticketRef,
          emailSubject: email.subject,
          // truncate body so IPC payload stays small
          emailBody:    (email.body || '').slice(0, 800).trim(),
          detectedPath: deployPath,
          confidence
        })
      }
    }

    fetched++
  }

  return { fetched, missingPaths }
}

async function fetchAll(appIds, sinceDate, allApps) {
  let totalFetched = 0
  let allMissing   = []
  const errors     = []

  for (const appId of appIds) {
    const app = allApps.find(a => a.id === appId)
    if (!app) continue
    try {
      const { fetched, missingPaths } = await fetchForApp(app, sinceDate)
      totalFetched += fetched
      allMissing    = allMissing.concat(missingPaths)
    } catch (e) {
      errors.push({ appId, appName: app.name, error: e.message })
    }
  }

  return { fetched: totalFetched, missingPaths: allMissing, errors }
}

module.exports = { fetchAll, fetchForApp }
