import { useState, useEffect } from 'react'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '')
}

export default function IgnoredFilesModal({ sourceAppId, compareAppId, sourceAppName, compareAppName, onClose }) {
  const [files, setFiles]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [working, setWorking]   = useState(false)

  async function load() {
    setLoading(true)
    try {
      const rows = await window.api.invoke('detect:list-ignored', { sourceAppId, compareAppId })
      setFiles(rows || [])
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function revert(relPaths) {
    setWorking(true)
    try {
      await window.api.invoke('detect:revert-ignore', { sourceAppId, compareAppId, relPaths })
      await load()
    } catch (e) {
      alert(`Failed to revert: ${e.message}`)
    } finally {
      setWorking(false)
    }
  }

  function toggleRow(rp) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(rp) ? next.delete(rp) : next.add(rp)
      return next
    })
  }

  const allChecked  = files.length > 0 && files.every(f => selected.has(f.rel_path))
  const someChecked = !allChecked && files.some(f => selected.has(f.rel_path))

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(files.map(f => f.rel_path)))
  }

  return (
    <div className="dm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dm-modal igf-modal">

        <div className="dm-header">
          <span className="dm-title">Ignored Files</span>
          <span className="igf-subtitle">{sourceAppName} → {compareAppName}</span>
          <button className="btn btn-ghost btn-sm dm-close" onClick={onClose}>✕</button>
        </div>

        {loading && <div className="igf-empty">Loading…</div>}

        {!loading && files.length === 0 && (
          <div className="igf-empty">No ignored files for this app pair.</div>
        )}

        {!loading && files.length > 0 && (
          <>
            <div className="igf-bulk-bar">
              <label className="dm-bulk-check">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked }}
                  onChange={toggleAll}
                />
                <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
              </label>
              <button
                className="btn btn-sm btn-primary"
                disabled={!selected.size || working}
                onClick={() => revert([...selected])}
              >
                Revert Selected ({selected.size})
              </button>
            </div>

            <div className="igf-list">
              <div className="igf-header">
                <span className="igf-hcb" />
                <span className="igf-hpath">File Path</span>
                <span className="igf-hdate">Ignored at</span>
                <span className="igf-hact" />
              </div>
              {files.map(f => (
                <div key={f.rel_path} className="igf-row">
                  <div className="igf-hcb">
                    <input type="checkbox" checked={selected.has(f.rel_path)} onChange={() => toggleRow(f.rel_path)} style={{ cursor: 'pointer', accentColor: '#007acc' }} />
                  </div>
                  <div className="igf-path">
                    <span className="igf-filename">{f.rel_path.split('/').pop()}</span>
                    <code className="igf-relpath">{f.rel_path}</code>
                  </div>
                  <div className="igf-date">{fmtDate(f.ignored_at)}</div>
                  <div className="igf-act">
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={working}
                      onClick={() => revert([f.rel_path])}
                    >
                      Revert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="dm-footer">
          <span className="dm-footer-hint">{files.length} file{files.length !== 1 ? 's' : ''} ignored</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
