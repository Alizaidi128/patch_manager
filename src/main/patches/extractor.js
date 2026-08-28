const AdmZip = require('adm-zip')
const path   = require('path')
const fs     = require('fs')

function applyTimestamp(filePath, rawTime) {
  try {
    if (!rawTime) return
    const mtime = rawTime instanceof Date ? rawTime : new Date(rawTime)
    if (isNaN(mtime.getTime()) || mtime.getFullYear() < 1980) return
    fs.utimesSync(filePath, mtime, mtime)
  } catch {}
}

async function extractZip(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const zip = new AdmZip(archivePath)
  zip.extractAllTo(destDir, true)
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory) {
      const filePath = path.join(destDir, entry.entryName)
      if (fs.existsSync(filePath)) applyTimestamp(filePath, entry.header.time)
    }
  }
  return destDir
}

async function extractRar(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  try {
    const { createExtractorFromFile } = require('node-unrar-js')
    const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir })
    const { files } = extractor.extract()
    for (const f of files) {
      if (f.fileHeader && !f.fileHeader.flags?.directory) {
        const filePath = path.join(destDir, f.fileHeader.name)
        if (fs.existsSync(filePath)) applyTimestamp(filePath, f.fileHeader.time)
      }
    }
    return destDir
  } catch (e) {
    throw new Error(`RAR extraction failed: ${e.message}. Ensure node-unrar-js is installed.`)
  }
}

async function extract(archivePath, destDir) {
  const ext = path.extname(archivePath).toLowerCase()
  if (ext === '.zip') return extractZip(archivePath, destDir)
  if (ext === '.rar') return extractRar(archivePath, destDir)
  throw new Error(`Unsupported archive format: ${ext}`)
}

module.exports = { extract, extractZip, extractRar }
