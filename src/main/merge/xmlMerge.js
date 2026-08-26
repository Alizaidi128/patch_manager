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

function applyMerge(existingXml, snippetXml) {
  const { toAdd } = previewMerge(existingXml, snippetXml)
  const inserts   = [
    ...toAdd.servlets.map(s => s.raw),
    ...toAdd.mappings.map(s => s.raw)
  ].join('\n')

  // Insert before closing </web-app>
  return existingXml.replace(/<\/web-app>\s*$/, `\n${inserts}\n</web-app>`)
}

module.exports = { previewMerge, applyMerge }
