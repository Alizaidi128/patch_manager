const AdmZip = require('adm-zip')
const path   = require('path')
const fs     = require('fs')

async function extractZip(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const zip = new AdmZip(archivePath)
  zip.extractAllTo(destDir, true) // overwrite = true
  return destDir
}

async function extractRar(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  try {
    const { createExtractorFromFile } = require('node-unrar-js')
    const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir })
    const { files } = extractor.extract()
    // Consume iterator to trigger extraction
    for (const _f of files) {}
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
