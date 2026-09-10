import { useState, useEffect, useRef, useCallback } from 'react'
import { XCircleIcon, CheckCircleIcon, AlertTriangleIcon } from '../icons.jsx'
import IgnoredFilesModal from './IgnoredFilesModal.jsx'

function fmtMtime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '')
}

function ValidationLine({ ok, warn, text }) {
  return (
    <div className={`dmv-line ${warn ? 'dmv-warn' : ok ? 'dmv-ok' : 'dmv-err'}`}>
      {warn ? <AlertTriangleIcon size={12} /> : ok ? <CheckCircleIcon size={12} /> : <XCircleIcon size={12} />}
      <span>{text}</span>
    </div>
  )
}

export default function DetectModeDialog({
  app, onClose, onViaPatchesDetect,
  task, onStartTask, onClearTask
}) {
  const [mode, setMode]             = useState('patches')
  const [allApps, setAllApps]       = useState([])
  const [sourceId, setSourceId]     = useState(app?.id ?? '')
  const [compareId, setCompareId]   = useState('')
  const [checking, setChecking]     = useState(false)
  const [validation, setValidation] = useState(null)
  const [selected, setSelected]           = useState(new Set())
  const [rowStates, setRowStates]         = useState({})   // relPath → 'copied'|'ignored'|'copying'|'error:msg'
  const [confirmIgnore, setConfirmIgnore] = useState(null) // relPaths[] pending confirm
  const [dropdownOpen, setDropdownOpen]   = useState(null) // relPath with open dropdown
  const [bulkWorking, setBulkWorking]     = useState(false)
  const [showIgnored, setShowIgnored]     = useState(false)
  const cancelRef    = useRef(false)
  const progressEndRef = useRef(null)

  useEffect(() => {
    window.api.invoke('app:list').then(apps => setAllApps(apps || []))
    return () => { cancelRef.current = true }
  }, [])

  // Reset row states when a new comparison starts
  useEffect(() => {
    if (task?.status === 'running') {
      setSelected(new Set())
      setRowStates({})
      setDropdownOpen(null)
      setConfirmIgnore(null)
    }
  }, [task?.status])

  // Auto-scroll progress list
  useEffect(() => {
    if (task?.status === 'running' && progressEndRef.current) {
      progressEndRef.current.scrollIntoView({ behavior: 'auto' })
    }
  }, [task?.progressFiles?.length])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = () => setDropdownOpen(null)
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  // Re-validate when app selection changes
  useEffect(() => {
    if (mode !== 'app') return
    if (task) return
    setValidation(null)
    if (!sourceId || !compareId || sourceId === compareId) return

    const src = allApps.find(a => a.id === Number(sourceId))
    const cmp = allApps.find(a => a.id === Number(compareId))
    if (!src || !cmp) return

    const isRdp      = a => (a.deployment_mode || '').toLowerCase() === 'rdp'
    const localLabel = a => ` (${a.deployment_mode || 'local'} — always accessible)`

    const sf = (src.outlook_folder_path || '').trim()
    const cf = (cmp.outlook_folder_path || '').trim()
    const folderMatch = sf === cf
    const folderMsg = {
      ok: folderMatch, warn: !folderMatch, text: folderMatch
        ? `Outlook folders match: "${sf || '(none)'}"`
        : `Outlook folders differ — source: "${sf || '(none)'}", comparison: "${cf || '(none)'}"`
    }

    const srcReachMsg = isRdp(src) ? null : { ok: true, warn: false, text: `Source "${src.name}" is reachable${localLabel(src)}` }
    const cmpReachMsg = isRdp(cmp) ? null : { ok: true, warn: false, text: `Comparison "${cmp.name}" is reachable${localLabel(cmp)}` }
    const anyRdp = isRdp(src) || isRdp(cmp)
    setChecking(anyRdp)
    setValidation({ msgs: [folderMsg, ...(srcReachMsg ? [srcReachMsg] : []), ...(cmpReachMsg ? [cmpReachMsg] : [])], canRun: !anyRdp })

    if (!anyRdp) return
    ;(async () => {
      const [sr, cr] = await Promise.all([
        isRdp(src) ? window.api.invoke('app:check-reachable', { appId: src.id }).catch(() => ({ reachable: false })) : Promise.resolve({ reachable: true }),
        isRdp(cmp) ? window.api.invoke('app:check-reachable', { appId: cmp.id }).catch(() => ({ reachable: false })) : Promise.resolve({ reachable: true })
      ])
      if (cancelRef.current) return
      const finalMsgs = [folderMsg]
      finalMsgs.push({ ok: sr.reachable, warn: false, text: sr.reachable ? `Source "${src.name}" is reachable` : `Source "${src.name}" is NOT reachable — check VPN` })
      finalMsgs.push({ ok: cr.reachable, warn: false, text: cr.reachable ? `Comparison "${cmp.name}" is reachable${isRdp(cmp) ? '' : localLabel(cmp)}` : `Comparison "${cmp.name}" is NOT reachable — check VPN` })
      setChecking(false)
      setValidation({ msgs: finalMsgs, canRun: sr.reachable && cr.reachable })
    })()
  }, [mode, sourceId, compareId, allApps, task])

  function handleRun() {
    if (mode === 'patches') { onViaPatchesDetect(); onClose(); return }
    onStartTask(Number(sourceId), Number(compareId), false)
  }

  // ---- Row actions ----

  const getResult = () => task?.result
  const getAppIds = () => ({ sourceAppId: getResult()?.sourceApp?.id, compareAppId: getResult()?.compareApp?.id })

  const activeMismatches = useCallback(() => {
    if (!task?.result) return []
    return task.result.mismatches.filter(m => rowStates[m.relPath] !== 'ignored')
  }, [task?.result, rowStates])

  async function handleCopy(mismatches) {
    setDropdownOpen(null)
    for (const m of mismatches) {
      setRowStates(prev => ({ ...prev, [m.relPath]: 'copying' }))
      try {
        await window.api.invoke('detect:copy-file', { srcPath: m.srcPath, cmpPath: m.cmpPath })
        setRowStates(prev => ({ ...prev, [m.relPath]: 'copied' }))
      } catch (e) {
        setRowStates(prev => ({ ...prev, [m.relPath]: `error:${e.message}` }))
      }
    }
    setSelected(new Set())
    setBulkWorking(false)
  }

  async function doIgnore(relPaths) {
    const { sourceAppId, compareAppId } = getAppIds()
    try {
      await window.api.invoke('detect:ignore-files', { sourceAppId, compareAppId, relPaths })
      setRowStates(prev => {
        const next = { ...prev }
        relPaths.forEach(rp => { next[rp] = 'ignored' })
        return next
      })
    } catch (e) {
      alert(`Failed to save ignore list: ${e.message}`)
    }
    setSelected(new Set())
    setBulkWorking(false)
  }

  function requestIgnore(relPaths) {
    setDropdownOpen(null)
    setConfirmIgnore(relPaths)
  }

  function handleBulkCopy() {
    if (!selected.size) return
    const mismatches = (getResult()?.mismatches || []).filter(m => selected.has(m.relPath))
    setBulkWorking(true)
    handleCopy(mismatches)
  }

  function handleBulkIgnore() {
    if (!selected.size) return
    requestIgnore([...selected])
  }

  function toggleRow(relPath) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(relPath) ? next.delete(relPath) : next.add(relPath)
      return next
    })
  }

  function toggleAll(mismatches) {
    const active = mismatches.filter(m => !rowStates[m.relPath] || rowStates[m.relPath].startsWith('error'))
    const allSelected = active.every(m => selected.has(m.relPath))
    setSelected(allSelected ? new Set() : new Set(active.map(m => m.relPath)))
  }

  // ---- Derived state ----
  const appOptions = allApps.filter(a => a.is_active !== 0)
  const canRunApp  = mode === 'app' && sourceId && compareId &&
    sourceId !== compareId && validation?.canRun && !checking && !task
  const isRunning  = task?.status === 'running'
  const isDone     = task?.status === 'done'
  const isError    = task?.status === 'error'
  const showTask   = isRunning || isDone || isError

  const visibleMismatches = isDone
    ? (task.result.mismatches || [])
    : []
  const activeRows = visibleMismatches.filter(m => !rowStates[m.relPath] || rowStates[m.relPath].startsWith('error') || rowStates[m.relPath] === 'copying')
  const allChecked = activeRows.length > 0 && activeRows.every(m => selected.has(m.relPath))
  const someChecked = !allChecked && activeRows.some(m => selected.has(m.relPath))

  return (
    <div className="dm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dm-modal">

        {/* Header */}
        <div className="dm-header">
          <span className="dm-title">Detect Deployment Status</span>
          <button className="btn btn-ghost btn-sm dm-close" onClick={onClose}>✕</button>
        </div>

        {/* Config UI */}
        {!showTask && (
          <>
            <div className="dm-modes">
              <label className={`dm-mode-card ${mode === 'patches' ? 'dm-mode-card--active' : ''}`}>
                <input type="radio" name="detect-mode" value="patches" checked={mode === 'patches'} onChange={() => setMode('patches')} />
                <div>
                  <div className="dm-mode-title">Via Patches</div>
                  <div className="dm-mode-desc">Compare each patch's files against the current app directory using modification dates and merge content.</div>
                </div>
              </label>
              <label className={`dm-mode-card ${mode === 'app' ? 'dm-mode-card--active' : ''}`}>
                <input type="radio" name="detect-mode" value="app" checked={mode === 'app'} onChange={() => setMode('app')} />
                <div>
                  <div className="dm-mode-title">Via App</div>
                  <div className="dm-mode-desc">Walk the source app's deployed files and find any that differ from a comparison app — then trace each mismatch back to the patch that last changed it.</div>
                </div>
              </label>
            </div>

            {mode === 'app' && (
              <div className="dm-app-config">
                <div className="dm-app-row">
                  <label className="dm-app-label">Source App <span className="dm-hint">(reference — already up to date)</span></label>
                  <select className="dm-app-select" value={sourceId} onChange={e => setSourceId(e.target.value)}>
                    <option value="">— Select source —</option>
                    {appOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="dm-app-row">
                  <label className="dm-app-label">Comparison App <span className="dm-hint">(to check for missing updates)</span></label>
                  <select className="dm-app-select" value={compareId} onChange={e => setCompareId(e.target.value)}>
                    <option value="">— Select comparison —</option>
                    {appOptions.filter(a => a.id !== Number(sourceId)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                {sourceId && compareId && sourceId !== compareId && (
                  <div className="dm-validation">
                    {validation && validation.msgs.map((m, i) => <ValidationLine key={i} ok={m.ok} warn={m.warn} text={m.text} />)}
                    {checking && <div className="dm-checking">Checking RDP connectivity…</div>}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Task UI */}
        {showTask && (
          <div className="dm-results">

            {/* Running: progress */}
            {isRunning && (
              <>
                <div className="dm-progress-header">
                  <span className="dm-progress-spinner" />
                  <span>Comparing files… <strong>{(task.progressFiles.length * 20).toLocaleString()}</strong>+ files scanned</span>
                </div>
                <div className="dm-progress-list">
                  {task.progressFiles.slice(-300).map((p, i) => (
                    <div key={i} className="dm-progress-item">
                      <span className="dm-progress-num">{p.compared?.toLocaleString()}</span>
                      <span className="dm-progress-path">{p.relPath}</span>
                    </div>
                  ))}
                  <div ref={progressEndRef} />
                </div>
              </>
            )}

            {/* Done: summary + bulk bar + mismatch table */}
            {isDone && (
              <>
                <div className="dm-results-summary">
                  <span>Compared <strong>{task.result.totalCompared.toLocaleString()}</strong> files{task.result.hitLimit ? ' (limit reached)' : ''}</span>
                  <span className={`dm-badge ${task.result.mismatches.length ? 'dm-badge--warn' : 'dm-badge--ok'}`}>
                    {task.result.mismatches.length} mismatch{task.result.mismatches.length !== 1 ? 'es' : ''}
                  </span>
                </div>
                {task.result.warnings.map((w, i) => <div key={i} className="dm-result-warning">⚠ {w}</div>)}

                {/* Bulk action bar */}
                {visibleMismatches.length > 0 && (
                  <div className="dm-bulk-bar">
                    <label className="dm-bulk-check">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked }}
                        onChange={() => toggleAll(visibleMismatches)}
                      />
                      <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
                    </label>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!selected.size || bulkWorking}
                      onClick={handleBulkCopy}
                    >
                      Copy ({selected.size})
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={!selected.size || bulkWorking}
                      onClick={handleBulkIgnore}
                    >
                      Ignore ({selected.size})
                    </button>
                  </div>
                )}

                {visibleMismatches.length === 0 && (
                  <div className="dm-no-mismatches">✓ All compared files match between both apps.</div>
                )}

                {visibleMismatches.length > 0 && (
                  <div className="dm-mismatch-list">
                    <div className="dm-mismatch-header dm-mismatch-header--actions">
                      <span className="dmh-cb" />
                      <span className="dmh-file">File / Path</span>
                      <span className="dmh-src">Source modified</span>
                      <span className="dmh-cmp">Comparison modified</span>
                      <span className="dmh-patch">Last patch (source)</span>
                      <span className="dmh-act" />
                    </div>
                    {visibleMismatches.map((m) => {
                      const rs = rowStates[m.relPath]
                      const isCopied   = rs === 'copied'
                      const isIgnored  = rs === 'ignored'
                      const isCopying  = rs === 'copying'
                      const hasError   = rs?.startsWith('error:')
                      const isSelectable = !isCopied && !isIgnored
                      return (
                        <div
                          key={m.relPath}
                          className={`dm-mismatch-row dm-mismatch-row--actions ${isCopied ? 'dmr--copied' : ''} ${isIgnored ? 'dmr--ignored' : ''}`}
                        >
                          <div className="dmr-cb">
                            {isSelectable && (
                              <input type="checkbox" checked={selected.has(m.relPath)} onChange={() => toggleRow(m.relPath)} />
                            )}
                          </div>
                          <div className="dmr-file">
                            <span className="dmr-filename">{m.filename}</span>
                            <code className="dmr-path" title={m.srcPath}>{m.relPath}</code>
                            {hasError && <span className="dmr-error">{rs.slice(6)}</span>}
                          </div>
                          <div className="dmr-src">{fmtMtime(m.srcMtime)}</div>
                          <div className={`dmr-cmp ${m.missing ? 'dmr-cmp--missing' : ''}`}>
                            {m.missing ? 'file missing' : fmtMtime(m.cmpMtime)}
                          </div>
                          <div className="dmr-patch">
                            {m.lastPatch ? (
                              <>
                                <span className="dmr-patch-date">{m.lastPatch.dateLabel} / folder {m.lastPatch.folderNum}</span>
                                <span className="dmr-patch-subj" title={m.lastPatch.emailSubject}>
                                  {(m.lastPatch.emailSubject || '').slice(0, 55)}{(m.lastPatch.emailSubject || '').length > 55 ? '…' : ''}
                                </span>
                              </>
                            ) : <span className="dmr-patch-none">no patch found</span>}
                          </div>
                          <div className="dmr-act">
                            {isCopied  && <span className="dmr-status dmr-status--ok">Copied</span>}
                            {isIgnored && <span className="dmr-status dmr-status--dim">Ignored</span>}
                            {isCopying && <span className="dmr-status dmr-status--spin">…</span>}
                            {!isCopied && !isIgnored && !isCopying && (
                              <div className="dm-row-dropdown" onMouseDown={e => e.stopPropagation()}>
                                <button
                                  className="btn btn-ghost btn-xs dm-row-dd-btn"
                                  onClick={() => setDropdownOpen(dropdownOpen === m.relPath ? null : m.relPath)}
                                >
                                  ⋮
                                </button>
                                {dropdownOpen === m.relPath && (
                                  <div className="dm-row-dd-menu">
                                    <button onClick={() => handleCopy([m])}>Copy to comparison app</button>
                                    <button onClick={() => requestIgnore([m.relPath])}>Ignore always</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="dm-results-footer">
                  <span className="dm-results-apps">{task.result.sourceApp.name} → {task.result.compareApp.name}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowIgnored(true)}>
                    View Ignored Files
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={onClearTask}>New Comparison</button>
                </div>
              </>
            )}

            {/* Error */}
            {isError && (
              <div className="dm-error">
                <XCircleIcon size={14} />
                <span>{task.error}</span>
              </div>
            )}
          </div>
        )}

        {/* Config footer */}
        {!showTask && (
          <div className="dm-footer">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleRun}
              disabled={mode === 'app' && !canRunApp}
              title={mode === 'app' && !canRunApp && !checking ? 'Select two reachable apps first' : undefined}
            >
              {mode === 'patches' ? 'Run Detection' : 'Run Comparison'}
            </button>
          </div>
        )}

        {/* Running footer: move to background */}
        {isRunning && (
          <div className="dm-footer">
            <span className="dm-footer-hint">Modal will stay open while comparing</span>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Run on Background</button>
          </div>
        )}

        {/* Error footer */}
        {isError && (
          <div className="dm-footer">
            <button className="btn btn-ghost btn-sm" onClick={onClearTask}>Back</button>
          </div>
        )}

        {/* Ignored files child modal */}
        {showIgnored && isDone && (
          <IgnoredFilesModal
            sourceAppId={task.result.sourceApp.id}
            compareAppId={task.result.compareApp.id}
            sourceAppName={task.result.sourceApp.name}
            compareAppName={task.result.compareApp.name}
            onClose={() => setShowIgnored(false)}
          />
        )}

        {/* Ignore confirmation overlay */}
        {confirmIgnore && (
          <div className="dm-confirm-overlay">
            <div className="dm-confirm-box">
              <div className="dm-confirm-title">Ignore {confirmIgnore.length} file{confirmIgnore.length !== 1 ? 's' : ''}?</div>
              <div className="dm-confirm-body">
                {confirmIgnore.length === 1
                  ? <><strong>{confirmIgnore[0]}</strong><br />This file will never appear in future comparisons between these two apps.</>
                  : `These ${confirmIgnore.length} files will never appear in future comparisons between these two apps.`
                }
              </div>
              <div className="dm-confirm-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmIgnore(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => { doIgnore(confirmIgnore); setConfirmIgnore(null) }}>
                  Yes, Ignore Always
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
