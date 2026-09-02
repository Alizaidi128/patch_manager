import { useState } from 'react'

const FILE_TYPE_LABEL = {
  gias_patch:       'GIAS',
  jsp:              'JSP',
  js_file:          'JS',
  xml_merge:        'XML',
  props_merge:      'Props',
  db_script:        'SQL',
  reference:        'Ref',
  inspect_archive:  'Archive',
}

const STATUS_META = {
  deployed:         { label: 'Deployed', cls: 'det-chip--deployed' },
  pending:          { label: 'Pending',  cls: 'det-chip--pending'  },
  unknown:          { label: 'Unknown',  cls: 'det-chip--unknown'  },
  error:            { label: 'Error',    cls: 'det-chip--error'    },
  'not-applicable': { label: 'N/A',      cls: 'det-chip--na'       },
}

function StatusChip({ status }) {
  const { label, cls } = STATUS_META[status] || STATUS_META.unknown
  return <span className={`det-chip ${cls}`}>{label}</span>
}

function FileRow({ file }) {
  const [expanded, setExpanded] = useState(false)
  const hasMissing = file.missingKeys?.length || file.pendingFiles?.length ||
                     file.missingServlets?.length || file.missingMappings?.length
  const canExpand  = hasMissing && file.status === 'pending'

  return (
    <div className="det-file-row">
      <span className={`det-type-badge det-type-${file.fileType}`}>
        {FILE_TYPE_LABEL[file.fileType] || file.fileType}
      </span>
      <span className="det-file-name">{file.filename}</span>
      <span className="det-file-detail">{file.detail}</span>
      <StatusChip status={file.status} />
      {canExpand && (
        <button className="det-expand-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? '▾' : '▸'}
        </button>
      )}

      {expanded && (
        <div className="det-missing-list">
          {file.missingKeys?.length > 0 && (
            <>
              <div className="det-missing-label">Missing properties:</div>
              {file.missingKeys.map((k, i) => (
                <div key={i} className="det-missing-item">
                  <span className="det-missing-bullet">•</span>
                  <code>{k}</code>
                </div>
              ))}
            </>
          )}
          {(file.missingServlets?.length > 0 || file.missingMappings?.length > 0) && (
            <>
              {file.missingServlets?.map((s, i) => (
                <div key={`srv-${i}`} className="det-missing-item">
                  <span className="det-missing-bullet">•</span>
                  <code>&lt;servlet&gt; {s}</code>
                </div>
              ))}
              {file.missingMappings?.map((s, i) => (
                <div key={`map-${i}`} className="det-missing-item">
                  <span className="det-missing-bullet">•</span>
                  <code>&lt;servlet-mapping&gt; {s}</code>
                </div>
              ))}
            </>
          )}
          {file.pendingFiles?.length > 0 && (
            <>
              <div className="det-missing-label">Not yet applied:</div>
              {file.pendingFiles.map((f, i) => (
                <div key={i} className="det-missing-item">
                  <span className="det-missing-bullet">•</span>
                  <code>{f}</code>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PatchCard({ patchResult, onDeployed }) {
  const [deployState, setDeployState] = useState(null)
  const [deployMsg,   setDeployMsg]   = useState(null)
  const [expanded,    setExpanded]    = useState(true)

  const emailDate = patchResult.emailDate
    ? new Date(patchResult.emailDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const deployedCount  = patchResult.files.filter(f => f.status === 'deployed').length
  const pendingCount   = patchResult.files.filter(f => f.status === 'pending').length
  const checkableCount = patchResult.files.filter(f => f.status !== 'not-applicable').length
  const isPending      = patchResult.detectedStatus === 'pending'

  async function handleDeploy() {
    setDeployState('checking')
    setDeployMsg(null)
    try {
      const preview = await window.api.invoke('deploy:preview', { patchId: patchResult.patchId })

      if (preview.blockedBy?.length > 0) {
        const subjects = preview.blockedBy
          .map(p => p.email_subject?.slice(0, 50) || `#${p.id}`)
          .join(', ')
        setDeployState('blocked')
        setDeployMsg(`Blocked by earlier undeployed patch${preview.blockedBy.length > 1 ? 'es' : ''}: ${subjects}`)
        return
      }

      const fileIds = preview.deployable?.map(f => f.id) || []
      if (!fileIds.length) {
        setDeployState('blocked')
        setDeployMsg('No deployable files found in this patch.')
        return
      }

      setDeployState('deploying')
      const result = await window.api.invoke('deploy:execute', { patchId: patchResult.patchId, fileIds, restartTomcat: false })

      const failed = result.results?.filter(r => !r.success) || []
      if (failed.length) {
        setDeployState('error')
        setDeployMsg(`${failed.length} file(s) failed: ${failed.map(f => f.error).join('; ')}`)
      } else {
        setDeployState('done')
        setDeployMsg(`Deployed successfully (${result.results?.length || 0} file${result.results?.length !== 1 ? 's' : ''})`)
        setTimeout(() => onDeployed(), 800)
      }
    } catch (e) {
      setDeployState('error')
      setDeployMsg(e.message)
    }
  }

  return (
    <div className={`det-patch-card det-patch-card--${patchResult.detectedStatus}`}>
      <div className="det-patch-header" onClick={() => setExpanded(e => !e)}>
        <span className="det-patch-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="det-patch-subject">{patchResult.subject || '(no subject)'}</span>
        <span className="det-patch-date">{emailDate}</span>
        <span className="det-patch-counts">
          {checkableCount > 0 && (
            <>
              <span className="det-count-ok">{deployedCount} ok</span>
              {pendingCount > 0 && <span className="det-count-pending">{pendingCount} pending</span>}
            </>
          )}
        </span>
        {patchResult.isUntracked && (
          <span className="det-untracked-badge" title="This folder is not imported in the database — fetch emails to import it">Not imported</span>
        )}
        {isPending && !patchResult.isUntracked && patchResult.patchStatus !== 'deployed' && (
          <button
            className={`btn btn-sm det-deploy-btn${deployState === 'deploying' ? ' det-deploy-btn--busy' : ''}`}
            disabled={deployState === 'deploying' || deployState === 'checking'}
            onClick={e => { e.stopPropagation(); handleDeploy() }}
            title="Deploy this patch now"
          >
            {deployState === 'checking'   ? 'Checking…'
             : deployState === 'deploying' ? 'Deploying…'
             : 'Deploy'}
          </button>
        )}
      </div>

      {deployMsg && (
        <div className={`det-deploy-msg det-deploy-msg--${deployState}`}>
          {deployState === 'done'    && '✓ '}
          {deployState === 'error'   && '✕ '}
          {deployState === 'blocked' && '⚠ '}
          {deployMsg}
        </div>
      )}

      {expanded && (
        <div className="det-file-list">
          {patchResult.files.map(f => (
            <FileRow key={f.fileId} file={f} />
          ))}
        </div>
      )}
    </div>
  )
}

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'pending',  label: 'Pending' },
  { key: 'deployed', label: 'Deployed' },
  { key: 'unknown',  label: 'Unknown' },
]

// Inline (non-modal) detection results panel — embedded directly in PatchInbox.
export default function DetectionResults({ data, onClose, onRedetect }) {
  const [filter, setFilter] = useState('all')

  const visibleResults = data.results.filter(p => {
    if (filter === 'all')     return true
    if (filter === 'unknown') return p.detectedStatus === 'unknown' || p.detectedStatus === 'not-applicable'
    return p.detectedStatus === filter
  })

  const summary = {
    total:    data.results.length,
    deployed: data.results.filter(p => p.detectedStatus === 'deployed').length,
    pending:  data.results.filter(p => p.detectedStatus === 'pending').length,
    unknown:  data.results.filter(p => p.detectedStatus === 'unknown' || p.detectedStatus === 'not-applicable').length,
  }

  return (
    <div className="detect-inline-panel">
      <div className="detect-inline-toolbar">
        <div className="det-top-bar" style={{ flex: 1, marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
          <div className="det-summary-bar">
            <span className="det-summary-label">{summary.total} patch{summary.total !== 1 ? 'es' : ''}</span>
            <span className="det-summary-sep">·</span>
            <span className="det-summary-deployed">{summary.deployed} deployed</span>
            {summary.pending > 0 && <>
              <span className="det-summary-sep">·</span>
              <span className="det-summary-pending">{summary.pending} pending</span>
            </>}
            {summary.unknown > 0 && <>
              <span className="det-summary-sep">·</span>
              <span className="det-summary-unknown">{summary.unknown} unknown</span>
            </>}
          </div>
          <div className="det-filter-tabs">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`det-filter-btn${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.key !== 'all' && (
                  <span className="det-filter-count">
                    {f.key === 'unknown' ? summary.unknown : summary[f.key] ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={onRedetect}>Re-detect</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="det-legend">
        <span className="det-legend-note">
          GIAS &amp; JSP/JS: compared by file date. Props &amp; XML: compared by content (missing keys/entries). Deploy buttons respect sequential order.
        </span>
      </div>

      <div className="det-patch-list">
        {visibleResults.map(p => (
          <PatchCard
            key={p.patchId}
            patchResult={p}
            onDeployed={onRedetect}
          />
        ))}
        {visibleResults.length === 0 && (
          <div className="det-empty">
            {filter === 'all' ? 'No patches found for this app.' : `No ${filter} patches.`}
          </div>
        )}
      </div>
    </div>
  )
}
