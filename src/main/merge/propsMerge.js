// Phase 4 — .properties file merge engine

function parseProps(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    map.set(trimmed.slice(0, eqIdx).trim(), trimmed)
  }
  return map
}

function previewMerge(existingText, snippetText) {
  const existingKeys = parseProps(existingText)
  const snippetKeys  = parseProps(snippetText)

  const toAdd         = []
  const alreadyPresent = []

  for (const [key, line] of snippetKeys) {
    if (existingKeys.has(key)) alreadyPresent.push({ key, line })
    else toAdd.push({ key, line })
  }

  return { toAdd, alreadyPresent }
}

function applyMerge(existingText, snippetText) {
  const { toAdd } = previewMerge(existingText, snippetText)
  if (toAdd.length === 0) return existingText

  const appended = toAdd.map(e => e.line).join('\n')
  return existingText.trimEnd() + '\n' + appended + '\n'
}

module.exports = { previewMerge, applyMerge }
