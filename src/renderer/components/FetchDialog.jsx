import { useState, useEffect } from 'react'

const today   = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// Lightweight config dialog — selecting apps and date range only.
// Clicking "Fetch" calls onStart(config) immediately and the dialog closes.
// The actual IPC call runs in the background; progress is shown inline in PatchInbox.
export default function FetchDialog({ apps, onClose, onStart }) {
  const [selectedIds, setSelectedIds] = useState([])
  const [since, setSince]   = useState(() => daysAgo(7))
  const [toDate, setToDate] = useState(() => today())

  const activeApps = apps.filter(a => a.is_active && a.outlook_folder_path)

  useEffect(() => {
    setSelectedIds(activeApps.map(a => a.id))
  }, [apps.length])

  function toggleApp(id) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function toggleAll() {
    if (selectedIds.length === activeApps.length) setSelectedIds([])
    else setSelectedIds(activeApps.map(a => a.id))
  }

  function handleFetch() {
    if (!selectedIds.length) return
    onStart({ appIds: selectedIds, since, toDate })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>📬 Fetch Emails from Outlook</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body fetch-dialog-body">
          <div className="fetch-section">
            <div className="fetch-section-label">Apps to fetch for</div>
            <div className="fetch-app-list">
              <label className="fetch-app-item select-all-row">
                <input
                  type="checkbox"
                  checked={selectedIds.length === activeApps.length}
                  onChange={toggleAll}
                />
                <span className="fetch-app-name" style={{ fontWeight: 600 }}>Select all</span>
              </label>
              {activeApps.map(app => (
                <label key={app.id} className="fetch-app-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(app.id)}
                    onChange={() => toggleApp(app.id)}
                  />
                  <span className="fetch-app-name">{app.name}</span>
                  <span className="fetch-app-folder">{app.outlook_folder_path}</span>
                </label>
              ))}
              {activeApps.length === 0 && (
                <div className="fetch-empty">No apps with an Outlook folder configured.</div>
              )}
            </div>
          </div>

          <div className="fetch-section">
            <div className="fetch-section-label">Date range</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>From</div>
                <input
                  type="date"
                  className="form-control"
                  style={{ width: 160 }}
                  value={since}
                  onChange={e => setSince(e.target.value)}
                  max={toDate}
                />
              </div>
              <div style={{ marginTop: 18, color: 'var(--text-secondary)' }}>→</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>To</div>
                <input
                  type="date"
                  className="form-control"
                  style={{ width: 160 }}
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  min={since}
                  max={today()}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleFetch}
            disabled={!selectedIds.length || !since || !toDate}
          >
            Fetch Emails
          </button>
        </div>
      </div>
    </div>
  )
}
