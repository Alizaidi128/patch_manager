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

  // MEDIUM: Windows-style paths
  const winPaths = body.match(/[A-Z][A-Z0-9_]{2,}(?:[\\\/][A-Z0-9_\-\.]+){2,}/gi) || []
  winPaths.forEach(p => add(p, 'medium'))

  return paths
}

module.exports = { extractDeploymentPaths }
