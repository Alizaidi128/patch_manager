import { useState, useEffect, useCallback } from 'react'
import PatchRow from './PatchRow'
import ConfirmDialog from './ConfirmDialog'

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'staged',   label: 'Staged' },
  { key: 'ready',    label: 'Ready' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'skipped',  label: 'Skipped' },
]

export default function PatchInbox({ app, onFetch, onMerge, onDeploy, refreshKey }) {
  const [patches, setPatches]       = useState([])
  const [tab, setTab]               = useState('all')
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState(new Set())
  const [deploying, setDeploying]     = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [confirm, setConfirm]         = useState(null) // { message, onConfirm }
  const [warState, setWarState]       = useState(null) // null | { running, steps, error }
  const [tomcatState, setTomcatState] = useState(null) // null | { running, result }

  const load = useCallback(async () => {
    if (!app) return
    setLoading(true)
    setSelected(new Set())
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

  function toggleSelect(patchId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(patchId)) next.delete(patchId)
      else next.add(patchId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === patches.length) setSelected(new Set())
    else setSelected(new Set(patches.map(p => p.id)))
  }

  function askConfirm(message, onConfirm) {
    setConfirm({ message, onConfirm })
  }

  async function handleDelete(patchId) {
    askConfirm('Delete this patch? This also removes local files from disk.', async () => {
      setConfirm(null)
      await window.api.invoke('patch:delete', { patchId })
      setSelected(prev => { const n = new Set(prev); n.delete(patchId); return n })
      load()
    })
  }

  async function handleDeleteSelected() {
    const deletable = patches.filter(p => selected.has(p.id) && p.status === 'staged')
    if (!deletable.length) return
    const count = deletable.length
    askConfirm(`Delete ${count} staged patch${count !== 1 ? 'es' : ''}? This also removes local files from disk.`, async () => {
      setConfirm(null)
      for (const p of deletable) {
        await window.api.invoke('patch:delete', { patchId: p.id })
      }
      setSelected(new Set())
      load()
    })
  }

  async function handleDeploySelected() {
    if (!selected.size || deploying) return
    setBatchResult(null)
    setDeploying(true)
    try {
      // Sort selected patches: by email_date ASC, then id ASC (oldest first)
      const toDeploy = patches
        .filter(p => selected.has(p.id))
        .sort((a, b) => {
          const da = new Date(a.email_date || 0).getTime()
          const db2 = new Date(b.email_date || 0).getTime()
          return da !== db2 ? da - db2 : a.id - b.id
        })
      const patchIds = toDeploy.map(p => p.id)
      const results = await window.api.invoke('deploy:batch', { patchIds })
      setBatchResult(results)
      load()
    } finally {
      setDeploying(false)
    }
  }

  async function handleDeployWar() {
    askConfirm(
      `Build and upload WAR for ${app.name}?\n\nThe existing WAR on the server will be renamed to a backup first.`,
      async () => {
        setConfirm(null)
        setWarState({ running: true, steps: [], error: null })
        // Listen for progress events
        const cleanup = window.api.on?.('war:progress', ({ step }) => {
          setWarState(s => s ? { ...s, steps: [...s.steps, step] } : s)
        })
        const res = await window.api.invoke('war:deploy', { appId: app.id })
        cleanup?.()
        setWarState({ running: false, steps: res.steps || [], error: res.error || null })
      }
    )
  }

  async function handleRestartTomcat() {
    askConfirm(`Restart Tomcat on ${app.name} server?`, async () => {
      setConfirm(null)
      setTomcatState({ running: true, result: null })
      const res = await window.api.invoke('tomcat:restart', { appId: app.id })
      setTomcatState({ running: false, result: res })
    })
  }

  async function handleRevertToStaged() {
    askConfirm(
      'TESTING ONLY: Revert all deployed patches back to staged?\nThis is for testing purposes only.',
      async () => {
        setConfirm(null)
        const res = await window.api.invoke('debug:revert-patches', { appId: app.id })
        load()
        setBatchResult([{ patchId: 0, skipped: true, reason: `Reverted ${res.reverted} patch(es) to staged` }])
      }
    )
  }

  const hasTomcat = app && (app.tomcat_remote_path || app.tomcat_service_name)
  const hasWar    = app && app.war_name && app.remote_war_path && app.local_src_path

  if (!app) {
    return (
      <div className="placeholder-screen">
        <div className="placeholder-icon">📬</div>
        <p>Select an app from the sidebar</p>
        <p className="hint">or add a new app to get started</p>
      </div>
    )
  }

  const allSelected = patches.length > 0 && selected.size === patches.length
  const someSelected = selected.size > 0 && !allSelected

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
          {patches.length > 0 && (
            <label className="select-all-label">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected }}
                onChange={toggleSelectAll}
              />
              <span>Select all</span>
            </label>
          )}
          {selected.size > 0 && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleDeploySelected}
              disabled={deploying}
            >
              {deploying ? 'Deploying…' : `🚀 Deploy ${selected.size} selected`}
            </button>
          )}
          {patches.filter(p => selected.has(p.id) && p.status === 'staged').length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleDeleteSelected}
            >
              🗑 Delete {patches.filter(p => selected.has(p.id) && p.status === 'staged').length} staged
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
          {hasWar && (
            <button
              className="btn btn-war btn-sm"
              onClick={handleDeployWar}
              disabled={warState?.running}
              title="Build WAR from local source and upload to server"
            >
              {warState?.running ? '⏳ Building…' : '📦 Deploy WAR'}
            </button>
          )}
          {hasTomcat && (
            <button
              className="btn btn-tomcat btn-sm"
              onClick={handleRestartTomcat}
              disabled={tomcatState?.running}
              title="Restart Tomcat on the remote server"
            >
              {tomcatState?.running ? '⏳ Restarting…' : '⟳ Restart Tomcat'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={onFetch}>
            📬 Fetch Emails
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleRevertToStaged}
            title="[TEST] Revert all deployed patches to staged"
            style={{ opacity: 0.5, fontSize: 10 }}
          >
            ↺ Revert
          </button>
        </div>
      </div>

      {batchResult && (
        <div className="batch-result-bar">
          {batchResult.map((r, i) => (
            <span key={i} className={`batch-result-item ${r.error ? 'fail' : 'ok'}`}>
              {r.error ? `✕ Patch ${r.patchId}: ${r.error}` : r.skipped ? `— ${r.reason || `Patch ${r.patchId}: nothing to deploy`}` : `✓ Patch ${r.patchId} deployed`}
            </span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setBatchResult(null)}>✕</button>
        </div>
      )}

      {warState && (
        <div className={`war-result-panel ${warState.error ? 'war-error' : warState.running ? 'war-running' : 'war-ok'}`}>
          <div className="war-result-header">
            <span>{warState.running ? '⏳ Building & uploading WAR…' : warState.error ? '✕ WAR deploy failed' : '✓ WAR deployed successfully'}</span>
            {!warState.running && <button className="btn btn-ghost btn-sm" onClick={() => setWarState(null)}>✕</button>}
          </div>
          <div className="war-result-steps">
            {(warState.steps || []).map((s, i) => <div key={i} className="war-step">{s}</div>)}
            {warState.error && <div className="war-step war-step-error">{warState.error}</div>}
          </div>
        </div>
      )}

      {tomcatState && (
        <div className={`war-result-panel ${tomcatState.running ? 'war-running' : tomcatState.result?.success ? 'war-ok' : 'war-error'}`}>
          <div className="war-result-header">
            <span>
              {tomcatState.running ? '⏳ Restarting Tomcat…'
                : tomcatState.result?.success ? '✓ Tomcat restarted'
                : `✕ Tomcat restart failed: ${tomcatState.result?.error}`}
            </span>
            {!tomcatState.running && <button className="btn btn-ghost btn-sm" onClick={() => setTomcatState(null)}>✕</button>}
          </div>
          {tomcatState.result?.output && (
            <div className="war-result-steps">
              <div className="war-step">{tomcatState.result.output}</div>
            </div>
          )}
        </div>
      )}

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
            selected={selected.has(p.id)}
            onToggleSelect={toggleSelect}
            onOpenFolder={openFolder}
            onMerge={file => onMerge({ patchFileId: file.id, filename: file.original_filename, fileType: file.file_type })}
            onDeploy={patchId => onDeploy(patchId)}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
