// Phase 4 — Generic fallback merge (manual line selection)
// The renderer handles the UI; this module applies user-selected line additions.

function applySelectedLines(existingText, selectedLines) {
  if (!selectedLines || selectedLines.length === 0) return existingText
  return existingText.trimEnd() + '\n' + selectedLines.join('\n') + '\n'
}

module.exports = { applySelectedLines }
