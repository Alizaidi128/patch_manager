// Phase 3 — Extract deployment paths from email body text
function extractDeploymentPaths(emailBody) {
  const body = emailBody || ''
  const paths = []
  const seen  = new Set()

  function add(p, confidence) {
    if (!p || p.length < 3 || seen.has(p)) return
    seen.add(p)
    paths.push({ path: p, confidence })
  }

  // High: explicit file path segments
  const filePaths = body.match(/(?:WEB-INF|webapps|ROOT|genins|assets)[\/\\][^\s\n"'<>]+/gi) || []
  filePaths.forEach(p => add(p, 'high'))

  // High: Windows-style paths with backslash
  const winPaths = body.match(/[A-Z][A-Z0-9_]{2,}(?:[\\\/][A-Z0-9_\-\.]+){2,}/gi) || []
  winPaths.forEach(p => add(p, 'high'))

  // Medium: "deploy to: ..." patterns
  const deployTo = body.match(/(?:deploy\s+(?:to|in|at|into)|place\s+(?:at|in|into))[:\s]+([^\s\n,\.]+)/gi) || []
  deployTo.forEach(m => {
    const p = m.replace(/(?:deploy\s+(?:to|in|at|into)|place\s+(?:at|in|into))[:\s]+/i, '').trim()
    add(p, 'medium')
  })

  // Low: "in the X folder"
  const inFolder = body.match(/\bin\s+(?:the\s+)?([a-zA-Z0-9_\-]+)\s+folder/gi) || []
  inFolder.forEach(m => {
    const p = m.replace(/\bin\s+(?:the\s+)?/i, '').replace(/\s+folder/i, '').trim()
    add(p, 'low')
  })

  return paths
}

module.exports = { extractDeploymentPaths }
