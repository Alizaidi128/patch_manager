// Phase 4 — XML (web.xml) merge engine
const fs  = require('fs')
const { XMLParser, XMLBuilder } = require('fast-xml-parser')

function parseServletBlocks(xmlText) {
  // Returns { servlets: [{name, raw}], mappings: [{name, raw}] }
  const servlets  = []
  const mappings  = []

  const srvRx = /<servlet>[\s\S]*?<\/servlet>/gi
  const mapRx = /<servlet-mapping>[\s\S]*?<\/servlet-mapping>/gi
  const nameRx = /<servlet-name>(.*?)<\/servlet-name>/i

  let m
  while ((m = srvRx.exec(xmlText)) !== null) {
    const nameMatch = nameRx.exec(m[0])
    servlets.push({ name: nameMatch ? nameMatch[1].trim() : '', raw: m[0] })
  }
  while ((m = mapRx.exec(xmlText)) !== null) {
    const nameMatch = nameRx.exec(m[0])
    mappings.push({ name: nameMatch ? nameMatch[1].trim() : '', raw: m[0] })
  }
  return { servlets, mappings }
}

function previewMerge(existingXml, snippetXml) {
  const existing = parseServletBlocks(existingXml)
  const snippet  = parseServletBlocks(snippetXml)
  const existingNames = new Set([...existing.servlets.map(s => s.name), ...existing.mappings.map(s => s.name)])

  const toAdd    = { servlets: [], mappings: [] }
  const existing_ = { servlets: [], mappings: [] }

  snippet.servlets.forEach(s => {
    if (existingNames.has(s.name)) existing_.servlets.push(s)
    else toAdd.servlets.push(s)
  })
  snippet.mappings.forEach(s => {
    if (existingNames.has(s.name)) existing_.mappings.push(s)
    else toAdd.mappings.push(s)
  })

  return { toAdd, alreadyPresent: existing_ }
}

// Returns [start, end] pairs for every <!-- ... --> block in xml.
function commentRanges(xml) {
  const ranges = []
  const openRx  = /<!--/g
  const closeRx = /-->/g
  let m
  while ((m = openRx.exec(xml)) !== null) {
    closeRx.lastIndex = m.index + 4
    const c = closeRx.exec(xml)
    if (c) ranges.push([m.index, c.index + 3])
  }
  return ranges
}

function inComment(idx, ranges) {
  return ranges.some(([s, e]) => idx >= s && idx <= e)
}

function applyMerge(existingXml, snippetXml) {
  const { toAdd } = previewMerge(existingXml, snippetXml)
  if (!toAdd.servlets.length && !toAdd.mappings.length) return existingXml

  const inserts = [
    ...toAdd.servlets.map(s => s.raw),
    ...toAdd.mappings.map(s => s.raw)
  ].join('\n')

  const comments  = commentRanges(existingXml)

  // Per the Servlet spec, servlet/servlet-mapping must come before welcome-file-list,
  // error-page, security-constraint, login-config, etc.
  // Find the first of those anchors that is NOT inside a comment block.
  const anchorRx = /(<welcome-file-list[\s>]|<error-page[\s>]|<security-constraint[\s>]|<login-config[\s>]|<\/web-app>)/gi
  let m
  while ((m = anchorRx.exec(existingXml)) !== null) {
    if (!inComment(m.index, comments)) {
      return existingXml.slice(0, m.index) + inserts + '\n' + existingXml.slice(m.index)
    }
  }
  return existingXml.replace(/<\/web-app>\s*$/, `\n${inserts}\n</web-app>`)
}

module.exports = { previewMerge, applyMerge }
