const path = require('path')

const IMAGE_EXTS  = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.ico','.svg','.webp','.tiff','.tif'])
const SCRIPT_EXTS = new Set(['.sql','.ddl','.dml','.sh','.bat','.ps1'])

function classifyAttachment(filename) {
  const lower = filename.toLowerCase()
  const ext   = path.extname(lower)

  // GIAS deployment archive (class/JSP files to copy directly to app)
  if (lower.includes('gias') && lower.includes('reserved_folder') && (ext === '.zip' || ext === '.rar')) return 'gias_patch'

  // All other archives — extract and classify contents (scripts, merge files, JSP, etc.)
  if (ext === '.zip' || ext === '.rar') return 'inspect_archive'

  // Images — ignored entirely (caller skips these)
  if (IMAGE_EXTS.has(ext)) return 'image'

  // Deployable source files
  if (ext === '.jsp') return 'jsp'
  if (ext === '.js')  return 'js_file'

  // XML merge
  if (ext === '.xml' || lower.includes('webxml') || lower.includes('web.xml') || lower.includes('web_xml') ||
      (ext === '.txt' && lower.includes('xml'))) return 'xml_merge'

  // Properties merge
  if (ext === '.properties') return 'props_merge'
  if (lower.includes('log4j') || lower.includes('log4property')) return 'props_merge'
  if (ext === '.txt' && (lower.includes('propert') || lower.includes('log4'))) return 'props_merge'
  // Label bundle files: labels.txt, label.txt, labelsbundle.txt, etc.
  if (ext === '.txt' && /^labels?(?:bundle)?(\.|_|$)/i.test(path.basename(lower))) return 'props_merge'

  // DB / shell scripts
  if (SCRIPT_EXTS.has(ext)) return 'db_script'
  if (ext === '.txt') return 'db_script'                 // plain text → treat as script
  if (lower.includes('script') || lower.includes('_ddl') || lower.includes('_dml')) return 'db_script'

  // Reference / docs
  if (['.doc','.docx','.xls','.xlsx','.pdf','.ppt','.pptx'].includes(ext) ||
      lower.includes('releasenote') || lower.includes('knockoff')) return 'reference'

  return 'unknown'
}

module.exports = { classifyAttachment }
