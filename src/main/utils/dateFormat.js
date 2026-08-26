const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

// Returns "AUG-26-2026" format
function formatDateFolder(date = new Date()) {
  const d = new Date(date)
  const mon = MONTHS[d.getMonth()]
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear()
  return `${mon}-${day}-${year}`
}

// Returns "2026-08-26T14:30:00"
function formatIso(date = new Date()) {
  return new Date(date).toISOString().replace('T', 'T').slice(0, 19)
}

module.exports = { formatDateFolder, formatIso }
