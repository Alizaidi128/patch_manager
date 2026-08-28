import { useState, useEffect } from 'react'

const ACTION_LABELS = {
  'deploy':         'Deploy',
  'deploy-gias':    'Deploy GIAS',
  'merge':          'Merge',
  'extract':        'Extract',
  'save_attachment':'Save Att.',
  'tomcat-restart': 'Tomcat Restart',
  'mark-manual':    'Mark Manual',
}

export default function DeployLog({ apps }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [appFilter, setAppFilter]   = useState('')
  const [sinceFilter, setSinceFilter] = useState('')
  const [exporting, setExporting]   = useState(false)

  async function load() {
    setLoading(true)
    try {
      const filters = {}
      if (appFilter)   filters.appId = Number(appFilter)
      if (sinceFilter) filters.since = sinceFilter
      const rows = await window.api.invoke('log:list', filters)
      setEntries(rows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [appFilter, sinceFilter])

  async function handleExport() {
    setExporting(true)
    try {
      const filters = {}
      if (appFilter)   filters.appId = Number(appFilter)
      if (sinceFilter) filters.since = sinceFilter
      await window.api.invoke('log:export-csv', filters)
    } finally {
      setExporting(false)
    }
  }

  const activeApps = (apps || []).filter(a => a.is_active)

  return (
    <div className="deploy-log-page">
      <div className="log-toolbar">
        <div className="log-filters">
          <select
            className="form-control log-filter-select"
            value={appFilter}
            onChange={e => setAppFilter(e.target.value)}
          >
            <option value="">All apps</option>
            {activeApps.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <input
            type="date"
            className="form-control log-filter-date"
            value={sinceFilter}
            onChange={e => setSinceFilter(e.target.value)}
            placeholder="Since date"
          />

          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={exporting || !entries.length}>
          {exporting ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>

      {entries.length === 0 && !loading && (
        <div className="log-empty">
          <div className="log-empty-icon">📋</div>
          <div>No log entries yet.</div>
          <div className="log-empty-hint">Actions like deploy, merge, and extract are recorded here.</div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="log-table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>App</th>
                <th>Action</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className={`log-row log-status-${e.status}`}>
                  <td className="log-time">
                    {new Date(e.logged_at).toLocaleString('en-GB', {
                      timeZone: 'Asia/Karachi',
                      day: '2-digit', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                      hour12: false
                    })} <span style={{ opacity: 0.5, fontSize: '0.75em' }}>PKT</span>
                  </td>
                  <td className="log-app">{e.app_name || '—'}</td>
                  <td className="log-action">
                    <span className="log-action-badge">
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td className="log-status-cell">
                    <span className={`status-badge status-${e.status === 'success' ? 'deployed' : 'failed'}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="log-detail" title={e.detail}>{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
