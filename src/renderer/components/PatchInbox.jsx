import { useState, useEffect, useCallback, useRef } from 'react'
import PatchRow from './PatchRow'
import ConfirmDialog from './ConfirmDialog'
import ScriptViewModal from './ScriptViewModal'
import DetectionResults from './DetectionResults'
import DetectModeDialog from './DetectModeDialog'
import {
  RocketIcon, TrashIcon, MailIcon, PackageIcon, ServerIcon,
  UndoIcon, RefreshCwIcon, CheckCircleIcon, XCircleIcon, InboxIcon, EyeIcon, ArchiveIcon, SearchIcon, ZapIcon
} from '../icons.jsx'

const STATUS_TABS = [
  { key: 'all',      label: 'All' },
  { key: 'staged',   label: 'Pending' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'skipped',  label: 'Skipped' },
]

function fmtFetchTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  }).replace(',', '')
}

export default function PatchInbox({ app, onFetch, onMerge, onDeploy, refreshKey, fetchState, onClearFetch, lastFetchedAt, autoFetchInterval }) {
  const [patches, setPatches]       = useState([])
  const [tab, setTab]               = useState('all')
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState(new Set())
  const [deploying, setDeploying]   = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [batchScriptResults, setBatchScriptResults] = useState(null) // [{ patchId, subject, scriptResult }]
  const [confirm, setConfirm]       = useState(null)
  const [warState, setWarState]           = useState(null)
  const [tomcatState, setTomcatState]     = useState(null)
  const [hotReloadState, setHotReloadState] = useState(null)
  const [detectState, setDetectState] = useState(null) // { _appId, running, data, error }
  const [scriptFile, setScriptFile]   = useState(null)
  const [masterScript, setMasterScript] = useState(null)
  const [serverOffline, setServerOffline] = useState(false)
  const [search, setSearch]           = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [detectModeOpen, setDetectModeOpen] = useState(false)
  const [viaAppTask, setViaAppTask]         = useState(null)
  const [nextFetchIn, setNextFetchIn]       = useState(null) // seconds until next auto-fetch
  const loadGenRef = useRef(0)

  // Live countdown for auto-fetch
  useEffect(() => {
    if (!autoFetchInterval || !lastFetchedAt) { setNextFetchIn(null); return }
    function calc() {
      const elapsed = (Date.now() - new Date(lastFetchedAt).getTime()) / 1000
      const remaining = Math.max(0, autoFetchInterval * 60 - elapsed)
      setNextFetchIn(Math.ceil(remaining))
    }
    calc()
    const id = setInterval(calc, 10_000)
    return () => clearInterval(id)
  }, [autoFetchInterval, lastFetchedAt])

  const load = useCallback(async () => {
    if (!app) return
    const gen = ++loadGenRef.current
    setLoading(true)
    setSelected(new Set())
    try {
      const filters = tab !== 'all' ? { status: tab } : {}

      // Run reachability check and patch list fetch in parallel so the ping
      // does not add latency to the normal (online) case.
      const [reachResult, rows] = await Promise.all([
        window.api.invoke('app:check-reachable', { appId: app.id }).catch(() => ({ reachable: true })),
        window.api.invoke('patch:list', { appId: app.id, ...filters })
      ])

      // Bail out if a newer load() has started (app switched while we were waiting)
      if (loadGenRef.current !== gen) return

      setServerOffline(!reachResult.reachable)

      if (!reachResult.reachable) {
        setPatches(rows)
        return
      }

      // Auto-detect deployment status by comparing file dates with the app directory.
      // Race against a 5-second timeout — if the server share is unreachable, Windows
      // fs calls hang; we show an offline warning instead of freezing the UI.
      const stagedIds = rows.filter(p => p.status === 'staged').map(p => p.id)
      if (stagedIds.length) {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
        try {
          const { updated } = await Promise.race([
            window.api.invoke('patch:auto-detect-status', { patchIds: stagedIds }),
            timeout
          ])
          if (loadGenRef.current !== gen) return
          if (updated.length > 0) {
            const refreshed = await window.api.invoke('patch:list', { appId: app.id, ...filters })
            if (loadGenRef.current !== gen) return
            setPatches(refreshed)
            return
          }
        } catch (e) {
          if (loadGenRef.current !== gen) return
          if (e.message === 'timeout') setServerOffline(true)
          // Non-timeout errors: still show patches, just skip auto-detect
        }
      }

      setPatches(rows)
    } finally {
      if (loadGenRef.current === gen) setLoading(false)
    }
  }, [app?.id, tab, refreshKey])

  useEffect(() => { setServerOffline(false); setDetectState(null) }, [app?.id])

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
    const allVisible = filteredPatches.every(p => selected.has(p.id))
    setSelected(prev => {
      const next = new Set(prev)
      filteredPatches.forEach(p => allVisible ? next.delete(p.id) : next.add(p.id))
      return next
    })
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

  async function handleMarkDeployedSelected() {
    const toMark = patches.filter(p => selected.has(p.id) && p.status === 'staged')
    if (!toMark.length) return
    for (const p of toMark) {
      await window.api.invoke('patch:mark-deployed', { patchId: p.id })
    }
    setSelected(new Set())
    load()
  }

  async function handleDeploySelected() {
    if (!selected.size || deploying) return
    setBatchResult(null)
    setBatchScriptResults(null)
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

      // Run Oracle scripts in oldest-first order for all patches that have scripts
      // (regardless of whether files were newly deployed or already skipped)
      const dbReady = app?.db_host && app?.db_user && app?.db_password_enc
      if (dbReady) {
        const scriptRuns = []
        for (const r of results) {
          if (r.error) continue  // skip only on hard error, not on skipped
          const patchObj = toDeploy.find(p => p.id === r.patchId)
          const scriptFile = (patchObj?.files || []).find(
            f => f.file_type === 'db_script' && f.original_filename === 'compiled_scripts.txt'
          )
          if (!scriptFile?.local_path) continue
          let scriptResult
          try {
            scriptResult = await window.api.invoke('oracle:run-script', {
              appId: app.id, scriptPath: scriptFile.local_path
            })
          } catch (e) {
            scriptResult = { success: false, error: e.message, results: [] }
          }
          scriptRuns.push({
            patchId: r.patchId,
            subject: patchObj?.email_subject || `Patch #${r.patchId}`,
            scriptResult
          })
        }
        if (scriptRuns.length) setBatchScriptResults(scriptRuns)
      }

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
        setWarState({ _appId: app.id, running: true, steps: [], pct: null, error: null })
        const cleanup = window.api.on?.('war:progress', ({ step, pct }) => {
          setWarState(s => {
            if (!s) return s
            if (pct != null) return { ...s, pct }
            return { ...s, steps: [...s.steps, step] }
          })
        })
        const res = await window.api.invoke('war:deploy', { appId: app.id })
        cleanup?.()
        setWarState({ _appId: app.id, running: false, steps: res.steps || [], pct: res.error ? null : 100, error: res.error || null })
      },
      { confirmLabel: 'Deploy WAR' }
    )
  }

  async function handleRestartTomcat() {
    askConfirm(
      `Restart Tomcat on ${app.name} server?`,
      async () => {
        setConfirm(null)
        setTomcatState({ _appId: app.id, running: true, result: null })
        const res = await window.api.invoke('tomcat:restart', { appId: app.id })
        setTomcatState({ _appId: app.id, running: false, result: res })
      },
      { confirmLabel: 'Restart Tomcat' }
    )
  }

  function handleHotReload() {
    askConfirm(
      `Hot-reload ${app.tomcat_context_path || 'app'} on ${app.name} via Tomcat Manager?`,
      async () => {
        setConfirm(null)
        setHotReloadState({ _appId: app.id, running: true, result: null })
        const res = await window.api.invoke('tomcat:hot-reload', { appId: app.id })
        setHotReloadState({ _appId: app.id, running: false, result: res })
      },
      { confirmLabel: 'Hot Reload' }
    )
  }

  async function handleDetect() {
    setDetectState({ _appId: app.id, running: true, data: null, error: null })
    try {
      const data = await window.api.invoke('patch:detect-all', { appId: app.id })
      setDetectState({ _appId: app.id, running: false, data, error: null })
    } catch (e) {
      setDetectState({ _appId: app.id, running: false, data: null, error: e.message })
    }
  }

  function startViaAppComparison(sourceAppId, compareAppId, background) {
    setViaAppTask({ status: 'running', background, progressFiles: [], result: null, error: null })
    if (background) setDetectModeOpen(false)

    const unsub = window.api.on('detect:via-app:progress', data => {
      setViaAppTask(prev => prev ? { ...prev, progressFiles: [...prev.progressFiles, data] } : null)
    })

    window.api.invoke('patch:detect-via-app', { sourceAppId, compareAppId })
      .then(result => {
        unsub()
        setViaAppTask(prev => prev ? { ...prev, status: 'done', result } : null)
      })
      .catch(err => {
        unsub()
        setViaAppTask(prev => prev ? { ...prev, status: 'error', error: err.message } : null)
      })
  }

  function startManualFolderComparison(sourceFolder, compareFolder, background) {
    setViaAppTask({ status: 'running', background, progressFiles: [], result: null, error: null })
    if (background) setDetectModeOpen(false)

    const unsub = window.api.on('detect:via-app:progress', data => {
      setViaAppTask(prev => prev ? { ...prev, progressFiles: [...prev.progressFiles, data] } : null)
    })

    window.api.invoke('patch:detect-via-folders', { sourceFolder, compareFolder })
      .then(result => {
        unsub()
        setViaAppTask(prev => prev ? { ...prev, status: 'done', result } : null)
      })
      .catch(err => {
        unsub()
        setViaAppTask(prev => prev ? { ...prev, status: 'error', error: err.message } : null)
      })
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

  // Only show state that belongs to the currently viewed app
  const curWarState       = warState?._appId       === app?.id ? warState       : null
  const curTomcatState    = tomcatState?._appId    === app?.id ? tomcatState    : null
  const curHotReloadState = hotReloadState?._appId === app?.id ? hotReloadState : null
  const curDetectState    = detectState?._appId    === app?.id ? detectState    : null

  const hasTomcat    = app && (app.tomcat_remote_path || app.tomcat_service_name)
  const hasWar       = app && app.deployment_mode === 'sftp' && app.war_name && app.local_src_path
  const hasHotReload = app && app.tomcat_manager_url && app.tomcat_context_path && app.tomcat_manager_user

  if (!app) {
    return (
      <div className="placeholder-screen">
        <div className="placeholder-icon"><InboxIcon size={44} style={{ opacity: 0.3 }} /></div>
        <p>Select an app from the sidebar</p>
        <p className="hint">or add a new app to get started</p>
      </div>
    )
  }

  // Client-side filtering by subject search and date range
  const filteredPatches = patches.filter(p => {
    if (search) {
      const subj = (p.email_subject || '').toLowerCase()
      if (!subj.includes(search.toLowerCase())) return false
    }
    if (dateFrom && p.email_date && p.email_date.slice(0, 10) < dateFrom) return false
    if (dateTo   && p.email_date && p.email_date.slice(0, 10) > dateTo)   return false
    return true
  })

  const allSelected  = filteredPatches.length > 0 && filteredPatches.every(p => selected.has(p.id))
  const someSelected = filteredPatches.some(p => selected.has(p.id)) && !allSelected
  const stagedInSel  = patches.filter(p => selected.has(p.id) && p.status === 'staged').length

  return (
    <div className="patch-inbox">
      {serverOffline && (
        <div className="inbox-offline-banner">
          <XCircleIcon size={14} />
          Application server unreachable — deployment status check skipped. Patches are shown as last known state.
        </div>
      )}
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
            <button className="btn btn-secondary btn-sm icon-btn" onClick={handleMarkDeployedSelected} title="Mark selected patches as already deployed">
              <CheckCircleIcon size={13} />
              Mark Deployed ({stagedInSel})
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
            onClick={() => setDetectModeOpen(true)}
            disabled={curDetectState?.running || serverOffline}
            title={serverOffline ? 'Server unreachable' : 'Detect deployment status — via patches or cross-app comparison'}
          >
            <SearchIcon size={13} />
            {curDetectState?.running ? 'Detecting…' : 'Detect Status'}
          </button>

          {hasWar && (
            <button
              className="btn btn-war btn-sm icon-btn"
              onClick={handleDeployWar}
              disabled={curWarState?.running || serverOffline}
              title={serverOffline ? 'Server unreachable' : 'Build WAR from local source and upload to server'}
            >
              <PackageIcon size={13} />
              {curWarState?.running ? 'Building…' : 'Deploy WAR'}
            </button>
          )}

          {hasTomcat && (
            <button
              className="btn btn-tomcat btn-sm icon-btn"
              onClick={handleRestartTomcat}
              disabled={curTomcatState?.running || serverOffline}
              title={serverOffline ? 'Server unreachable' : 'Restart Tomcat on the remote server'}
            >
              <ServerIcon size={13} />
              {curTomcatState?.running ? 'Restarting…' : 'Restart Tomcat'}
            </button>
          )}

          {hasHotReload && (
            <button
              className="btn btn-hot-reload btn-sm icon-btn"
              onClick={handleHotReload}
              disabled={curHotReloadState?.running || serverOffline}
              title={serverOffline ? 'Server unreachable' : `Hot-reload ${app.tomcat_context_path} via Tomcat Manager (fast, no JVM restart)`}
            >
              <ZapIcon size={13} />
              {curHotReloadState?.running ? 'Reloading…' : 'Hot Reload'}
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

          <div className="fetch-btn-group">
            {(lastFetchedAt || autoFetchInterval > 0) && (
              <span className="last-fetched-hint">
                {lastFetchedAt
                  ? <span className="last-fetched-time">{fmtFetchTime(lastFetchedAt)}</span>
                  : <span className="last-fetched-time">Never fetched</span>
                }
                {autoFetchInterval > 0 && (
                  <span className="auto-fetch-countdown">
                    {nextFetchIn === null ? `every ${autoFetchInterval}m`
                      : nextFetchIn <= 0 ? 'fetching…'
                      : `auto in ${nextFetchIn < 60 ? `${nextFetchIn}s` : `${Math.ceil(nextFetchIn / 60)}m`}`}
                  </span>
                )}
              </span>
            )}
            <button
              className="btn btn-primary btn-sm icon-btn"
              onClick={onFetch}
              disabled={serverOffline}
              title={serverOffline ? 'Server unreachable' : undefined}
            >
              <MailIcon size={13} />
              Fetch Emails
            </button>
          </div>

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

      <div className="inbox-filter-row">
        <SearchIcon size={13} className="inbox-filter-icon" />
        <input
          className="inbox-search-input"
          type="text"
          placeholder="Search by subject…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className="inbox-filter-label">From</label>
        <input
          className="inbox-date-input"
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <label className="inbox-filter-label">To</label>
        <input
          className="inbox-date-input"
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
        {(search || dateFrom || dateTo) && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}>
              Clear
            </button>
            <span className="inbox-filter-count">{filteredPatches.length} / {patches.length} patches</span>
          </>
        )}
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
          <button className="btn btn-ghost btn-sm" onClick={() => { setBatchResult(null); setBatchScriptResults(null) }}>✕</button>
        </div>
      )}

      {batchScriptResults && (
        <div className="batch-oracle-panel">
          <div className="batch-oracle-header">
            <span>Oracle Script Results</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setBatchScriptResults(null)}>✕</button>
          </div>
          {batchScriptResults.map((run, ri) => {
            const sr   = run.scriptResult
            const ok   = (sr.results || []).filter(s => s.success).length
            const fail = (sr.results || []).filter(s => !s.success).length
            return (
              <div key={ri} className="batch-oracle-patch">
                <div className={`batch-oracle-patch-header ${sr.success ? 'oracle-run-ok' : 'oracle-run-fail'}`}>
                  {sr.success ? `✅ ${run.subject}` : `❌ ${run.subject}`}
                  <span className="batch-oracle-counts">
                    {ok > 0 && <span className="batch-oracle-ok">{ok} ok</span>}
                    {fail > 0 && <span className="batch-oracle-fail">{fail} failed</span>}
                  </span>
                </div>
                <div className="oracle-stmt-list">
                  {(sr.results || []).map((s, si) => (
                    <div key={si} className={`oracle-stmt ${s.success ? 'oracle-stmt-ok' : 'oracle-stmt-fail'}`}>
                      <span className="oracle-stmt-num">{s.index + 1}.</span>
                      <code className="oracle-stmt-text">{s.stmt}</code>
                      {s.success && s.rowsAffected != null && (
                        <span className="oracle-stmt-rows">{s.rowsAffected} row{s.rowsAffected !== 1 ? 's' : ''}</span>
                      )}
                      {!s.success && <span className="oracle-stmt-err">{s.error}</span>}
                    </div>
                  ))}
                  {!sr.results?.length && sr.error && (
                    <div className="oracle-stmt oracle-stmt-fail">
                      <span className="oracle-stmt-num">—</span>
                      <span className="oracle-stmt-err">{sr.error}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {curWarState && (
        <div className={`war-panel ${curWarState.error ? 'war-panel--error' : curWarState.running ? 'war-panel--running' : 'war-panel--ok'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {curWarState.running
                ? <span className="war-spinner" />
                : curWarState.error
                  ? <XCircleIcon size={15} />
                  : <CheckCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {curWarState.running
                ? 'Building & uploading WAR…'
                : curWarState.error
                  ? 'WAR deploy failed'
                  : 'WAR deployed successfully'}
            </span>
            {!curWarState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setWarState(null)}>✕</button>
            )}
          </div>

          {curWarState.pct != null && (
            <div className="war-progress-wrap">
              <div className="war-progress-bar">
                <div className="war-progress-fill" style={{ width: `${curWarState.pct}%` }} />
              </div>
              <span className="war-progress-pct">{curWarState.pct}%</span>
            </div>
          )}

          {curWarState.steps.length > 0 && (
            <div className="war-steps">
              {curWarState.steps.map((s, i) => <div key={i} className="war-step-row">{s}</div>)}
              {curWarState.error && <div className="war-step-row war-step-row--error">{curWarState.error}</div>}
            </div>
          )}
        </div>
      )}

      {curTomcatState && (
        <div className={`war-panel ${curTomcatState.running ? 'war-panel--running' : curTomcatState.result?.success ? 'war-panel--ok' : 'war-panel--error'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {curTomcatState.running
                ? <span className="war-spinner" />
                : curTomcatState.result?.success
                  ? <CheckCircleIcon size={15} />
                  : <XCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {curTomcatState.running
                ? 'Restarting Tomcat…'
                : curTomcatState.result?.success
                  ? 'Tomcat restarted'
                  : `Tomcat restart failed: ${curTomcatState.result?.error}`}
            </span>
            {!curTomcatState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setTomcatState(null)}>✕</button>
            )}
          </div>
          {curTomcatState.result?.output && (
            <div className="war-steps">
              <div className="war-step-row" style={{ whiteSpace: 'pre-wrap' }}>{curTomcatState.result.output}</div>
            </div>
          )}
        </div>
      )}

      {curHotReloadState && (
        <div className={`war-panel ${curHotReloadState.running ? 'war-panel--running' : curHotReloadState.result?.success ? 'war-panel--ok' : 'war-panel--error'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {curHotReloadState.running
                ? <span className="war-spinner" />
                : curHotReloadState.result?.success
                  ? <CheckCircleIcon size={15} />
                  : <XCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {curHotReloadState.running
                ? `Hot-reloading ${app.tomcat_context_path}…`
                : curHotReloadState.result?.success
                  ? `Hot reload complete — ${app.tomcat_context_path}`
                  : `Hot reload failed: ${curHotReloadState.result?.error}`}
            </span>
            {!curHotReloadState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setHotReloadState(null)}>✕</button>
            )}
          </div>
          {curHotReloadState.result?.output && (
            <div className="war-steps">
              <div className="war-step-row">{curHotReloadState.result.output}</div>
            </div>
          )}
        </div>
      )}

      {fetchState && fetchState.appIds?.includes(app?.id) && (
        <div className={`war-panel ${fetchState.error ? 'war-panel--error' : fetchState.running ? 'war-panel--running' : 'war-panel--ok'}`}>
          <div className="war-panel-header">
            <span className="war-panel-icon">
              {fetchState.running
                ? <span className="war-spinner" />
                : fetchState.error
                  ? <XCircleIcon size={15} />
                  : <CheckCircleIcon size={15} />}
            </span>
            <span className="war-panel-title">
              {fetchState.running
                ? `${fetchState.isAutoFetch ? 'Auto-fetching' : 'Fetching'} emails from Outlook… Do not close Outlook.`
                : fetchState.error
                  ? `Fetch failed: ${fetchState.error}`
                  : (() => {
                      const r = fetchState.result || {}
                      const parts = [`${r.fetched ?? 0} new`]
                      if (r.duplicates) parts.push(`${r.duplicates} already imported`)
                      if ((r.scanned ?? 0) === 0) parts.push('0 found in folder')
                      else if ((r.scanned ?? 0) > (r.fetched ?? 0) + (r.duplicates ?? 0)) parts.push(`${r.scanned - (r.fetched ?? 0) - (r.duplicates ?? 0)} skipped (no patch files)`)
                      return `Fetch complete — ${parts.join(', ')}`
                    })()}
            </span>
            {!fetchState.running && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={onClearFetch}>✕</button>
            )}
          </div>
          {!fetchState.running && fetchState.result?.errors?.length > 0 && (
            <div className="war-steps">
              {fetchState.result.errors.map((e, i) => (
                <div key={i} className="war-step-row war-step-row--error">{e.appName}: {e.error}</div>
              ))}
            </div>
          )}
          {!fetchState.running && fetchState.result?.missingPaths?.length > 0 && (
            <div className="war-steps">
              <div className="war-step-row" style={{ color: 'var(--warning)' }}>
                ⚠ {fetchState.result.missingPaths.length} file{fetchState.result.missingPaths.length !== 1 ? 's' : ''} need a deployment path — check the prompt.
              </div>
            </div>
          )}
        </div>
      )}

      {curDetectState?.error && !curDetectState.running && (
        <div className="war-panel war-panel--error">
          <div className="war-panel-header">
            <span className="war-panel-icon"><XCircleIcon size={15} /></span>
            <span className="war-panel-title">Detection failed: {curDetectState.error}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setDetectState(null)}>✕</button>
          </div>
        </div>
      )}

      {curDetectState?.data && !curDetectState.running && (
        <DetectionResults
          data={curDetectState.data}
          onClose={() => setDetectState(null)}
          onRedetect={handleDetect}
        />
      )}

      {/* Via App background task status bar */}
      {viaAppTask && !detectModeOpen && (
        <div className={`via-app-bg-bar${viaAppTask.status === 'done' ? ' via-app-bg-bar--done' : viaAppTask.status === 'error' ? ' via-app-bg-bar--error' : ''}`}>
          {viaAppTask.status === 'running' && (
            <>
              <span className="via-app-bg-spinner" />
              <span>Comparing apps in background… <strong>{viaAppTask.progressFiles.length}</strong> files scanned</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetectModeOpen(true)}>Show Details</button>
            </>
          )}
          {viaAppTask.status === 'done' && (
            <>
              <CheckCircleIcon size={13} />
              <span>Comparison complete — <strong>{viaAppTask.result?.mismatches?.length ?? 0}</strong> mismatch{(viaAppTask.result?.mismatches?.length ?? 0) !== 1 ? 'es' : ''} found</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetectModeOpen(true)}>View Results</button>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => setViaAppTask(null)}>✕</button>
            </>
          )}
          {viaAppTask.status === 'error' && (
            <>
              <XCircleIcon size={13} />
              <span>Comparison failed: {viaAppTask.error}</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setViaAppTask(null)}>✕</button>
            </>
          )}
        </div>
      )}

      <div className="inbox-list" style={curDetectState?.data && !curDetectState.running ? { display: 'none' } : undefined}>
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

        {!loading && patches.length > 0 && filteredPatches.length === 0 && (
          <div className="inbox-empty">
            <div style={{ opacity: 0.4, marginBottom: 8 }}>No patches match the current filter.</div>
          </div>
        )}

        {filteredPatches.length > 0 && (
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

        {filteredPatches.map(p => (
          <PatchRow
            key={p.id}
            patch={p}
            app={app}
            selected={selected.has(p.id)}
            onToggleSelect={toggleSelect}
            onOpenFolder={openFolder}
            onMerge={file => onMerge({ patchFileId: file.id, filename: file.original_filename, fileType: file.file_type })}
            onDeploy={patchId => onDeploy(patchId)}
            onDelete={handleDelete}
            onMarkDeployed={handleMarkDeployed}
            onViewScript={file => setScriptFile(file)}
            onPathSaved={load}
            serverOffline={serverOffline}
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

      {detectModeOpen && (
        <DetectModeDialog
          app={app}
          onClose={() => setDetectModeOpen(false)}
          onViaPatchesDetect={() => { setDetectModeOpen(false); handleDetect() }}
          task={viaAppTask}
          onStartTask={startViaAppComparison}
          onStartManualTask={startManualFolderComparison}
          onClearTask={() => setViaAppTask(null)}
        />
      )}

    </div>
  )
}
