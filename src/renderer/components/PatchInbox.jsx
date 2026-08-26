import { useState, useEffect, useCallback } from 'react'
import PatchRow from './PatchRow'

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'staged',   label: 'Staged' },
  { key: 'ready',    label: 'Ready' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'skipped',  label: 'Skipped' },
]

export default function PatchInbox({ app, onFetch, onMerge, onDeploy, refreshKey }) {
  const [patches, setPatches] = useState([])
  const [tab, setTab]         = useState('all')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!app) return
    setLoading(true)
    try {
      const filters = tab !== 'all' ? { status: tab } : {}
      const rows = await window.api.invoke('patch:list', { appId: app.id, ...filters })
      setPatches(rows)
    } finally {
      setLoading(false)
    }
  }, [app?.id, tab, refreshKey])

  useEffect(() => { load() }, [load])

  function openFolder(folderPath) {
    window.api.invoke('shell:open-folder', folderPath)
  }

  if (!app) {
    return (
      <div className="placeholder-screen">
        <div className="placeholder-icon">📬</div>
        <p>Select an app from the sidebar</p>
        <p className="hint">or add a new app to get started</p>
      </div>
    )
  }

  return (
    <div className="patch-inbox">
      <div className="inbox-toolbar">
        <div className="tab-group">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              className={`tab-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="inbox-toolbar-right">
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={onFetch}>
            📬 Fetch Emails
          </button>
        </div>
      </div>

      <div className="inbox-list">
        {loading && patches.length === 0 && (
          <div className="inbox-loading">Loading patches…</div>
        )}

        {!loading && patches.length === 0 && (
          <div className="inbox-empty">
            <div className="inbox-empty-icon">📭</div>
            <div>No {tab !== 'all' ? tab + ' ' : ''}patches for <strong>{app.name}</strong></div>
            <div className="inbox-empty-hint">Click <strong>Fetch Emails</strong> to import from Outlook.</div>
          </div>
        )}

        {patches.map(p => (
          <PatchRow
            key={p.id}
            patch={p}
            onOpenFolder={openFolder}
            onMerge={file => onMerge({ patchFileId: file.id, filename: file.original_filename, fileType: file.file_type })}
            onDeploy={patchId => onDeploy(patchId)}
          />
        ))}
      </div>
    </div>
  )
}
