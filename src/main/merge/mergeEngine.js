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

async function readFromServer(app, remotePath) {
  if (app.deployment_mode === 'smb' || app.deployment_mode === 'rdp_assisted') {
    if (!fs.existsSync(remotePath)) throw new Error(`File not found on server: ${remotePath}`)
    return fs.readFileSync(remotePath, 'utf8')
  }

  if (app.deployment_mode === 'sftp') {
    const SftpClient = require('ssh2-sftp-client')
    const sftp = new SftpClient()
    const tmp  = path.join(os.tmpdir(), `pm_read_${Date.now()}`)
    try {
      await sftp.connect(sftpOpts(app))
      await sftp.fastGet(remotePath, tmp)
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

async function writeToServer(app, remotePath, content) {
  const ts = Date.now()

  if (app.deployment_mode === 'smb' || app.deployment_mode === 'rdp_assisted') {
    const bak = `${remotePath}.bak-${ts}`
    if (fs.existsSync(remotePath)) fs.copyFileSync(remotePath, bak)
    fs.mkdirSync(path.dirname(remotePath), { recursive: true })
    fs.writeFileSync(remotePath, content, 'utf8')
    return bak
  }

  if (app.deployment_mode === 'sftp') {
    const SftpClient = require('ssh2-sftp-client')
    const sftp = new SftpClient()
    const tmp  = path.join(os.tmpdir(), `pm_write_${ts}`)
    fs.writeFileSync(tmp, content, 'utf8')
    try {
      await sftp.connect(sftpOpts(app))
      const bak = `${remotePath}.bak-${ts}`
      try { await sftp.rename(remotePath, bak) } catch {}
      await sftp.fastPut(tmp, remotePath)
      await sftp.end()
      try { fs.unlinkSync(tmp) } catch {}
    } catch (e) {
      try { await sftp.end() } catch {}
      try { fs.unlinkSync(tmp) } catch {}
      throw e
    }
  }
}

// If the stored deploy_target_path is a directory, append the original filename.
function resolveFilePath(deployTargetPath, originalFilename) {
  try {
    if (fs.existsSync(deployTargetPath) && fs.statSync(deployTargetPath).isDirectory()) {
      return path.join(deployTargetPath, originalFilename)
    }
  } catch {}
  // Also treat as directory if it ends with a path separator or has no extension
  if (deployTargetPath.endsWith('\\') || deployTargetPath.endsWith('/') ||
      !path.extname(deployTargetPath)) {
    return path.join(deployTargetPath, originalFilename)
  }
  return deployTargetPath
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
  const existing = await readFromServer(app, resolvedPath)

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

  return {
    ...preview,
    mergedContent,
    fileType:   file.file_type,
    filename:   file.original_filename,
    deployPath: resolvedPath
  }
}

async function applyMerge(patchFileId, mergedContent) {
  const { file, patch, app } = getFileWithContext(patchFileId)

  const resolvedPath = resolveFilePath(file.deploy_target_path, file.original_filename)
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

module.exports = { previewMerge, applyMerge }
