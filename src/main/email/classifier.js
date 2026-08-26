// Phase 3 — Attachment type classifier
const path = require('path')

function classifyAttachment(filename) {
  const lower = filename.toLowerCase()
  const ext   = path.extname(lower)

  if (lower.includes('gias_reserved_folders') && (ext === '.zip' || ext === '.rar')) return 'gias_patch'
  if (ext === '.jsp') return 'jsp'
  if (lower.includes('webxml') || lower.includes('web.xml') || lower.includes('web_xml') ||
      ext === '.xml' || (ext === '.txt' && lower.includes('xml'))) return 'xml_merge'
  if (ext === '.properties' || lower.includes('log4j') || lower.includes('log4property') ||
      (ext === '.txt' && (lower.includes('propert') || lower.includes('log4')))) return 'props_merge'
  if (ext === '.sql' || lower.includes('script_') || lower.includes('_script')) return 'db_script'
  if (['.doc','.docx','.xls','.xlsx','.pdf','.ppt','.pptx'].includes(ext) ||
      lower.includes('releasenote') || lower.includes('knockoff')) return 'reference'
  return 'unknown'
}

module.exports = { classifyAttachment }
