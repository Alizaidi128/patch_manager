import { useState, useEffect, useCallback } from 'react'
import PatchRow from './PatchRow'
import ConfirmDialog from './ConfirmDialog'
import ScriptViewModal from './ScriptViewModal'
import DetectionModal from './DetectionModal'
import {
  RocketIcon, TrashIcon, MailIcon, PackageIcon, ServerIcon,
  UndoIcon, RefreshCwIcon, CheckCircleIcon, XCircleIcon, InboxIcon, EyeIcon, ArchiveIcon, SearchIcon
} from '../icons.jsx'

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'staged',   label: 'Pending' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'skipped',  label: 'Skipped' },
]

export default function PatchInbox({ app, onFetch, onMerge, onDeploy, refreshKey }) {
  const [patches, setPatches]       = useState([])
  const [tab, setTab]               = useState('all')
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState(new Set())
  const [deploying, setDeploying]   = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [confirm, setConfirm]       = useState(null)
  const [warState, setWarState]       = useState(null)
  const [tomcatState, setTomcatState] = useState(null)
  const [scriptFile, setScriptFile]   = useState(null)  // single patch_file for row-level view
  const [masterScript, setMasterScript] = useState(null) // array of {file,patchSubject} for toolbar view
  const [showDetection, setShowDetection] = useState(false)

  const load = useCallback(async () => {
    if (!app) return
    setLoading(true)
    setSelected(new Set())
    try {
      const filters = tab !== 'all' ? { status: tab } : {}
      const rows = await window.api.invoke('patch:list', { appId: app.id, ...filters })

      // Auto-detect deployment status by comparing file dates with the app directory
      const stagedIds = rows.filter(p => p.status === 'staged').map(p => p.id)
      if (stagedIds.length) {
        const { updated } = await window.api.invoke('patch:auto-detect-status', { patchIds: stagedIds })
        if (updated.length > 0) {
          const refreshed = await window.api.invoke('patch:list', { appId: app.id, ...filters })
          setPatches(refreshed)
          return
        }
      }

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

  function askConfirm(message, onConfirm, { confirmLabel = 'Confirm', danger = false } = {}) {
    setConfirm({ message, onConfirm, confirmLabel, danger })
  }

  async function handleDelete(patchId) {
    askConfirm(
      'Delete this patch? This also removes local files from disk.',
      async () => {
        setConfirm(null)
        await window.api.invoke('patch:delete', { patchId })
        setSelected(prev => { const n = new Set(prev); n.delete(patchId); return n })
        load()
      },
      { confirmLabel: 'Delete', danger: true }
    )
  }

  async function handleDeleteSelected() {
    const deletable = patches.filter(p => selected.has(p.id) && p.status === 'staged')
    if (!deletable.length) return
    const count = deletable.length
    askConfirm(
      `Delete ${count} pending patch${count !== 1 ? 'es' : ''}? This also removes local files from disk.`,
      async () => {
        setConfirm(null)
        for (const p of deletable) {
          await window.api.invoke('patch:delete', { patchId: p.id })
        }
        setSelected(new Set())
        load()
      },
      { confirmLabel: 'Delete', danger: true }
    )
  }

  async function handleMarkDeployed(patchId) {
    await window.api.invoke('patch:mark-deployed', { patchId })
    load()
  }

  async function handleDeploySelected() {
    if (!selected.size || deploying) return
    setBatchResult(null)
    setDeploying(true)
    try {
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
        setWarState({ running: true, steps: [], pct: null, error: null })
        const cleanup = window.api.on?.('war:progress', ({ step, pct }) => {
          setWarState(s => {
            if (!s) return s
            if (pct != null) return { ...s, pct }
            return { ...s, steps: [...s.steps, step] }
          })
        })
        const res = await window.api.invoke('war:deploy', { appId: app.id })
        cleanup?.()
        setWarState({ running: false, steps: res.steps || [], pct: res.error ? null : 100, error: res.error || null })
      },
      { confirmLabel: 'Deploy WAR' }
    )
  }

  async function handleRestartTomcat() {
    askConfirm(
      `Restart Tomcat on ${app.name} server?`,
      async () => {
        setConfirm(null)
        setTomcatState({ running: true, result: null })
        const res = await window.api.invoke('tomcat:restart', { appId: app.id })
        setTomcatState({ running: false, result: res })
      },
      { confirmLabel: 'Restart Tomcat' }
    )
  }


  async function handleArchive() {
    const patchIds = selected.size > 0
      ? [...selected]
      : patches.map(p => p.id)
    if (!patchIds.length) return

    const destDir = await window.api.invoke('dialog:browse-folder')
    if (!destDir) return

    const res = await window.api.invoke('patches:archive', { patchIds, destDir })
    const ok  = res.results.filter(r => r.success).length
    const fail = res.results.filter(r => r.error).length
    const msg  = ok > 0
      ? `Archived ${ok} patch${ok !== 1 ? 'es' : ''} to ${destDir}${fail ? ` (${fail} failed)` : ''}`
      : `Archive failed for all ${fail} patch${fail !== 1 ? 'es' : ''}`
    setBatchResult([{ patchId: 0, skipped: true, reason: msg }])
  }

  async function handleRevertToStaged() {
    askConfirm(
      'TESTING ONLY: Revert all deployed patches back to Pending?\nThis is for testing purposes only.',
      async () => {
        setConfirm(null)
        const res = await window.api.invoke('debug:revert-patches', { appId: app.id })
        load()
        setBatchResult([{ patchId: 0, skipped: true, reason: `Reverted ${res.reverted} patch(es) to Pending` }])
      },
      { confirmLabel: 'Revert', danger: true }
    )
  }

  // Collect compiled script files from all selected patches
  function handleViewMasterScript() {
    const items = []
    for (const p of patches) {
      if (!selected.has(p.id)) continue
      const compiled = (p.files || []).find(
        f => f.file_type === 'db_script' && f.original_filename === 'compiled_scripts.txt'
      )
      if (compiled) items.push({ file: compiled, patchSubject: p.email_subject || '(no subject)' })
    }
    if (items.length) setMasterScript(items)
  }

  // Whether any selected patch has a compiled script
  const selectedScriptCount = patches.filter(
    p => selected.has(p.id) && (p.files || []).some(
      f => f.file_type === 'db_script' && f.original_filename === 'compiled_scripts.txt'
    )
  ).length

  const hasTomcat = app && (app.tomcat_remote_path || app.tomcat_service_name)
  const hasWar    = app && app.deployment_mode === 'sftp' && app.war_name && app.local_src_path

  if (!app) {
    return (
      <div className="placeholder-screen">
        <div className="placeholder-icon"><InboxIcon size={44} style={{ opacity: 0.3 }} /></div>
        <p>Select an app from the sidebar</p>
        <p className="hint">or add a new app to get started</p>
      </div>
    )
  }

  const allSelected  = patches.length > 0 && selected.size === patches.length
  const someSelected = selected.size > 0 && !allSelected
  const stagedInSel  = patches.filter(p => selected.has(p.id) && p.status === 'staged').length

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
            <button className="btn btn-primary btn-sm icon-btn" onClick={handleDeploySelected} disabled={deploying}>
              <RocketIcon size={13} />
              {deploying ? 'Deploying…' : `Deploy ${selected.size}`}
            </button>
          )}

          {stagedInSel > 0 && (
            <button className="btn btn-danger btn-sm icon-btn" onClick={handleDeleteSelected}>
              <TrashIcon size={13} />
              Delete {stagedInSel} Pending
            </button>
          )}

          <button className="btn btn-secondary btn-sm icon-btn" onClick={load} disabled={loading}>
            <RefreshCwIcon size={13} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>

          <button
            className="btn btn-detect btn-sm icon-btn"
            onClick={() => setShowDetection(true)}
            title="Check which patches and merge files are already deployed by comparing with app directory"
          >
            <SearchIcon size={13} />
            Detect Status
          </button>

          {hasWar && (
            <button
              className="btn btn-war btn-sm icon-btn"
              onClick={handleDeployWar}
              disabled={warState?.running}
              title="Build WAR from local source and upload to server"
            >
              <PackageIcon size={13} />
              {warState?.running ? 'Building…' : 'Deploy WAR'}
            </button>
          )}

          {hasTomcat && (
            <button
              className="btn btn-tomcat btn-sm icon-btn"
              onClick={handleRestartTomcat}
              disabled={tomcatState?.running}
              title="Restart Tomcat on the remote server"
            >
              <ServerIcon size={13} />
              {tomcatState?.running ? 'Restarting…' : 'Restart Tomcat'}
            </button>
          )}

          <button
            className="btn btn-secondary btn-sm icon-btn"
            onClick={handleArchive}
            title={selected.size > 0 ? `Archive ${selected.size} selected patches as ZIP` : 'Archive all patches as ZIP files'}
          >
            <ArchiveIcon size={13} />
            Archive {selected.size > 0 ? `(${selected.size})` : 'All'}
          </button>

          <button className="btn btn-primary btn-sm icon-btn" onClick={onFetch}>
            <MailIcon size={13} />
            Fetch Emails
          </button>

          {selectedScriptCount > 0 && (
            <button
              className="btn btn-script-view btn-sm icon-btn"
              onClick={handleViewMasterScript}
              title={`View compiled scripts from ${selectedScriptCount} selected patch${selectedScriptCount !== 1 ? 'es' : ''}`}
            >
              <EyeIcon size={13} />
              View Scripts ({selectedScriptCount})
            </button>
          )}

          <button
            className="btn btn-revert btn-sm icon-btn"
            onClick={handleRevertToStaged}
            title="[TEST ONLY] Revert all deployed patches back to staged"
          >
            <UndoIcon size={13} />
            Revert (Test)
          </button>
        </div>
      </div>

      {batchResult && (
        <div className="batch-result-bar">
          {batchResult.map((r, i) => (
            <span key={i} className={`batch-result-item ${r.error ? 'fail' : 'ok'}`}>
              {r.error
                ? `✕ Patch ${r.patchId}: ${r.error}`
                : r.skipped
                  ? `— ${r.reason || `Patch ${r.patchId}: nothing to deploy`}`
                  : `✓ Patch ${r.patchId} deployed`}
            </span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setBatchResult(null)}>✕</button>
        </div>
      )}

      {warState && (
        <div className={`war-panel ${warState.error ? 'war-panel--error' : warState.running ? 'war-panel--running' : 'war-panel--ok'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {warState.running
                ? <span className="war-spinner" />
                : warState.error
                  ? <XCircleIcon size={15} />
                  : <CheckCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {warState.running
                ? 'Building & uploading WAR…'
                : warState.error
                  ? 'WAR deploy failed'
                  : 'WAR deployed successfully'}
            </span>
            {!warState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setWarState(null)}>✕</button>
            )}
          </div>

          {warState.pct != null && (
            <div className="war-progress-wrap">
              <div className="war-progress-bar">
                <div className="war-progress-fill" style={{ width: `${warState.pct}%` }} />
              </div>
              <span className="war-progress-pct">{warState.pct}%</span>
            </div>
          )}

          {warState.steps.length > 0 && (
            <div className="war-steps">
              {warState.steps.map((s, i) => <div key={i} className="war-step-row">{s}</div>)}
              {warState.error && <div className="war-step-row war-step-row--error">{warState.error}</div>}
            </div>
          )}
        </div>
      )}

      {tomcatState && (
        <div className={`war-panel ${tomcatState.running ? 'war-panel--running' : tomcatState.result?.success ? 'war-panel--ok' : 'war-panel--error'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {tomcatState.running
                ? <span className="war-spinner" />
                : tomcatState.result?.success
                  ? <CheckCircleIcon size={15} />
                  : <XCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {tomcatState.running
                ? 'Restarting Tomcat…'
                : tomcatState.result?.success
                  ? 'Tomcat restarted'
                  : `Tomcat restart failed: ${tomcatState.result?.error}`}
            </span>
            {!tomcatState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setTomcatState(null)}>✕</button>
            )}
          </div>
          {tomcatState.result?.output && (
            <div className="war-steps">
              <div className="war-step-row" style={{ whiteSpace: 'pre-wrap' }}>{tomcatState.result.output}</div>
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
            <div className="inbox-empty-icon"><MailIcon size={40} style={{ opacity: 0.25 }} /></div>
            <div>No {tab !== 'all' ? tab + ' ' : ''}patches for <strong>{app.name}</strong></div>
            <div className="inbox-empty-hint">Click <strong>Fetch Emails</strong> to import from Outlook.</div>
          </div>
        )}

        {patches.length > 0 && (
          <div className="patch-list-header">
            <span className="patch-list-header-subject">Subject</span>
            <div className="patch-list-header-meta">
              <span style={{ width: 90, textAlign: 'right', flexShrink: 0 }}>Type</span>
              <span style={{ width: 44, textAlign: 'right', flexShrink: 0 }}>Files</span>
              <span style={{ width: 90, textAlign: 'right', flexShrink: 0 }}>Date</span>
              <span style={{ width: 72, textAlign: 'right', flexShrink: 0 }}>Time</span>
              <span style={{ width: 90, flexShrink: 0 }}></span>
              <span style={{ width: 70, textAlign: 'right', flexShrink: 0 }}>Status</span>
            </div>
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
            onMarkDeployed={handleMarkDeployed}
            onViewScript={file => setScriptFile(file)}
            onPathSaved={load}
          />
        ))}
      </div>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          confirmLabel={confirm.confirmLabel || 'Confirm'}
          danger={confirm.danger || false}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {scriptFile && (
        <ScriptViewModal
          patchFile={scriptFile}
          onClose={() => setScriptFile(null)}
        />
      )}

      {masterScript && (
        <ScriptViewModal
          patchFiles={masterScript}
          onClose={() => setMasterScript(null)}
        />
      )}

      {showDetection && (
        <DetectionModal
          appId={app.id}
          appName={app.name}
          onClose={() => { setShowDetection(false); load() }}
        />
      )}
    </div>
  )
}
