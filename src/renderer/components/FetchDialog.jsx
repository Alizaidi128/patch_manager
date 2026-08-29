import { useState, useEffect } from 'react'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function FetchDialog({ apps, onClose, onComplete }) {
  const [step, setStep]     = useState('config') // config | running | done
  const [selectedIds, setSelectedIds] = useState([])
  const [since, setSince]   = useState(() => daysAgo(7))
  const [toDate, setToDate] = useState(() => today())
  const [result, setResult] = useState(null)
  const [error, setError]   = useState(null)

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

  async function handleFetch() {
    if (!selectedIds.length) return
    setStep('running')
    setError(null)
    try {
      const res = await window.api.invoke('outlook:fetch', { appIds: selectedIds, sinceDate: since, toDate })
      setResult(res)
      setStep('done')
    } catch (e) {
      setError(e.message)
      setStep('config')
    }
  }

  function handleDone() {
    onComplete(result)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && step !== 'running' && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>📬 Fetch Emails from Outlook</h3>
          {step !== 'running' && (
            <button className="modal-close" onClick={onClose}>✕</button>
          )}
        </div>

        <div className="modal-body fetch-dialog-body">
          {step === 'config' && (
            <>
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

              {error && <div className="alert alert-error" style={{ margin: '0 16px 12px' }}>{error}</div>}
            </>
          )}

          {step === 'running' && (
            <div className="fetch-running">
              <div className="fetch-spinner" />
              <div className="fetch-running-text">Fetching emails from Outlook…</div>
              <div className="fetch-running-hint">Do not close Outlook while fetching.</div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="fetch-results">
              <div className="fetch-result-row">
                <span className="fetch-result-icon ok">✓</span>
                <span><strong>{result.fetched}</strong> new patch email{result.fetched !== 1 ? 's' : ''} imported</span>
              </div>

              {result.missingPaths && result.missingPaths.length > 0 && (
                <div className="fetch-result-row warn">
                  <span className="fetch-result-icon warn">⚠</span>
                  <span>
                    <strong>{result.missingPaths.length}</strong> file{result.missingPaths.length !== 1 ? 's' : ''} need a deployment path — you'll be prompted to enter them.
                  </span>
                </div>
              )}

              {result.errors && result.errors.length > 0 && (
                <div className="fetch-error-list">
                  {result.errors.map((e, i) => (
                    <div key={i} className="fetch-result-row error">
                      <span className="fetch-result-icon fail">✕</span>
                      <span><strong>{e.appName}:</strong> {e.error}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.duplicates > 0 && (
                <div className="fetch-result-row">
                  <span className="fetch-result-icon">ℹ</span>
                  <span><strong>{result.duplicates}</strong> email{result.duplicates !== 1 ? 's' : ''} already imported (skipped) — check the Patch Inbox.</span>
                </div>
              )}

              {result.fetched === 0 && (!result.errors || !result.errors.length) && (!result.duplicates) && (
                <div className="fetch-result-row">
                  <span className="fetch-result-icon">ℹ</span>
                  <span>No new emails found between {since} and {toDate}.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'config' && (
            <>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleFetch}
                disabled={!selectedIds.length || !since || !toDate}
              >
                Fetch Emails
              </button>
            </>
          )}
          {step === 'done' && (
            <button className="btn btn-primary" onClick={handleDone}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
