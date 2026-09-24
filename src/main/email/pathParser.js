// Common English words that appear in deployment instructions but are NOT folder names
const PATH_BLOCKLIST = new Set([
  'attached', 'attach', 'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'file', 'files', 'below', 'above', 'following', 'please', 'kindly', 'note',
  'path', 'folder', 'directory', 'point', 'at', 'to', 'in', 'into', 'for',
  'and', 'or', 'of', 'on', 'from', 'with', 'as', 'by', 'it', 'is', 'be',
  'are', 'was', 'were', 'has', 'have', 'had', 'not', 'also', 'all', 'any',
  'new', 'old', 'same', 'dear', 'ali', 'regards', 'hi', 'hello'
])

function extractDeploymentPaths(emailBody) {
  const body = emailBody || ''
  const paths = []
  const seen  = new Set()

  function add(p, confidence) {
    if (!p) return
    // Strip wildcards, backslash prefixes, and trailing slashes/dots
    p = p.replace(/^[\\\/]+/, '').replace(/[*?]/g, '').replace(/[\/\\\.]+$/, '').trim()
    // Strip trailing \.ext remnants from wildcard patterns like \\di\*.jsp → di\.jsp → di
    p = p.replace(/[\\\/]\.[a-zA-Z]{1,4}$/, '')
    // Strip GIAS_APP/ prefix — it's a placeholder tag for the app root, not a real folder
    p = p.replace(/^GIAS[_A-Z0-9]*[\/\\]/i, '')
    if (p.length < 2 || seen.has(p)) return
    // Skip common English words that aren't folder names
    if (PATH_BLOCKLIST.has(p.toLowerCase())) return
    seen.add(p)
    paths.push({ path: p, confidence })
  }

  // HIGH: explicit "deploy/place/put ... in/into X folder" instruction
  // Handles plain names, backtick-quoted, single/double-quoted
  const deployInFolder = body.match(
    /\b(?:deploy|place|put|copy)\b[^.!?\n]{0,60}?\b(?:in|into)\s+[`"']?([a-zA-Z0-9_\-]+)[`"']?\s+folder/gi
  ) || []
  deployInFolder.forEach(m => {
    const match = m.match(/\b(?:in|into)\s+[`"']?([a-zA-Z0-9_\-]+)[`"']?\s+folder/i)
    if (match) add(match[1], 'high')
  })

  // HIGH: explicit path segments with known roots — also match bare known folder names preceded by \\
  const filePaths = body.match(
    /(?:WEB-INF|webapps|ROOT|genins|gnled|glas|di|wf|healthins|secman|shmalib|shsm|para|param|assets|gias|modules)[\/\\][^\s\n"'<>*?]*/gi
  ) || []
  filePaths.forEach(p => add(p, 'high'))

  // HIGH: bare known folder names (\\genins or \\genins\*.jsp → "genins")
  const knownFolders = body.match(
    /(?:\\{1,2}|\/)?(genins|gnled|glas|di|wf|healthins|secman|shmalib|shsm|para|param|WEB-INF)(?:[\\\/][^\s\n"'<>]*)?/gi
  ) || []
  knownFolders.forEach(p => add(p, 'high'))

  // HIGH: "deploy to/in: X" or "path: X" patterns
  // Note: \b after 'at' prevents matching "attached", "attach", etc.
  const deployTo = body.match(
    /(?:deploy\s+(?:to\b|in\b|at\b|into\b)|place\s+(?:at\b|in\b|into\b)|path\s*:)\s*[`"']?([^\s\n,\."'`<>]+)[`"']?/gi
  ) || []
  deployTo.forEach(m => {
    const match = m.match(/[:\s]\s*[`"']?([^\s\n,\."'`<>]+)[`"']?$/)
    if (match) add(match[1], 'high')
  })

  // MEDIUM: standalone known folder names mentioned near "folder" keyword
  const folderMention = body.match(/\b([a-zA-Z][a-zA-Z0-9_\-]{2,})\s+folder\b/gi) || []
  folderMention.forEach(m => {
    const p = m.replace(/\s+folder\b/i, '').trim()
    add(p, 'medium')
  })

  // HIGH: "Application Path: X" pattern (common in Pakistani enterprise email style)
  const appPathMatches = body.match(/application\s+path\s*:\s*([^\s\n,<>]+)/gi) || []
  appPathMatches.forEach(m => {
    const match = m.match(/:\s*([^\s\n,<>]+)$/)
    if (match) add(match[1], 'high')
  })

  // MEDIUM: Windows-style paths
  const winPaths = body.match(/[A-Z][A-Z0-9_]{2,}(?:[\\\/][A-Z0-9_\-\.]+){2,}/gi) || []
  winPaths.forEach(p => add(p, 'medium'))

  return paths
}

// Extract <servlet> and <servlet-mapping> blocks from email body.
// Used to create a virtual web.xml merge file when no attachment carries them.
function extractBodyXml(rawBody) {
  if (!rawBody) return null
  const servlets  = rawBody.match(/<servlet[\s\S]*?<\/servlet>/gi)  || []
  const mappings  = rawBody.match(/<servlet-mapping[\s\S]*?<\/servlet-mapping>/gi) || []
  if (!servlets.length && !mappings.length) return null
  return [...servlets, ...mappings].map(b => b.trim()).join('\n')
}

// Extract label/properties key=value lines from email body.
// Lines must contain a key with at least one underscore or dot (e.g. postingbulk_ref_busiclass)
// to avoid false positives from English sentences.
// Returns a props-format string, or null if fewer than 2 lines matched.
function extractBodyProps(rawBody) {
  if (!rawBody) return null
  const lines      = rawBody.split(/\r?\n/)
  const propLines  = []
  // Key: starts with a letter, contains at least one _ or . separator, alphanumeric/underscore/dot/hyphen only
  const KEY_RE     = /^[ \t]*([a-zA-Z][a-zA-Z0-9_.-]*[._][a-zA-Z0-9_.-]+)\s*=\s*(.+)$/
  for (const line of lines) {
    const m = line.match(KEY_RE)
    if (m) propLines.push(`${m[1].trim()} = ${m[2].trim()}`)
  }
  return propLines.length >= 2 ? propLines.join('\n') : null
}

// Build a filename → folder map from email body lines that associate a specific
// file with a specific folder. Handles patterns like:
//   "fn_gl_tb_invoicedtl.jsp in gnled folder."
//   "2. pgl_se_tax_mapping.jsp in param folder."
//   "place report.jsp into genins/"
// Returns { 'filename.ext': 'folderName', ... } (keys are lowercase for comparison).
function extractFilePathMap(emailBody) {
  const body  = emailBody || ''
  const map   = {}

  // Pattern: <filename.ext> ... in/into <folder> [folder]
  // Allows list markers (1. 2.) and arbitrary words between filename and "in"
  const FILE_FOLDER = /(?:^|[\s\n])(?:\d+[.)]\s*)?([a-zA-Z0-9_\-.]+\.(?:jsp|sql|xml|js|properties|txt|sh|bat|ddl|dml))\b[^.\n]{0,80}?\bin(?:to)?\s+[`"']?([a-zA-Z0-9_\-]+)[`"']?(?:\s+folder)?/gim
  let m
  while ((m = FILE_FOLDER.exec(body)) !== null) {
    const filename = m[1].toLowerCase()
    const folder   = m[2]
    if (!PATH_BLOCKLIST.has(folder.toLowerCase()) && folder.length >= 2) {
      map[filename] = folder
    }
  }

  // Pattern: place/put/copy <filename.ext> [to/in/into/at] <path>
  const FILE_DEPLOY = /\b(?:deploy|place|put|copy)\s+([a-zA-Z0-9_\-.]+\.(?:jsp|sql|xml|js|properties|txt|sh|bat|ddl|dml))\b[^.\n]{0,40}?\b(?:to|in(?:to)?|at)\s+[`"']?([a-zA-Z0-9_\/\\\-]+)[`"']?/gim
  while ((m = FILE_DEPLOY.exec(body)) !== null) {
    const filename = m[1].toLowerCase()
    const folder   = m[2]
    if (!PATH_BLOCKLIST.has(folder.toLowerCase()) && folder.length >= 2 && !(filename in map)) {
      map[filename] = folder
    }
  }

  return map
}

module.exports = { extractDeploymentPaths, extractFilePathMap, extractBodyXml, extractBodyProps }
