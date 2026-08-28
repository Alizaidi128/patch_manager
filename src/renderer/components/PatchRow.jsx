import { useState } from 'react'
import { RocketIcon, FolderIcon } from '../icons.jsx'

const FILE_TYPE_LABEL = {
  gias_patch:  'GIAS',
  jsp:         'JSP',
  js_file:     'JS',
  xml_merge:   'XML',
  props_merge: 'Props',
  db_script:   'SQL',
  reference:   'Ref',
  unknown:     '?',
}

// File-level deploy status labels
const STATUS_LABELS = {
  pending:  'Pending',
  skipped:  'Skipped',
  deployed: 'Deployed',
  failed:   'Failed',
  merged:   'Merged',
}

// Patch-level status labels (staged shows as "Pending" in UI)
const PATCH_STATUS_LABELS = {
  staged:   'Pending',
  deployed: 'Deployed',
  skipped:  'Skipped',
  failed:   'Failed',
}

const MERGE_TYPES = new Set(['xml_merge', 'props_merge'])

function FileRow({ file, onMerge, onViewScript }) {
  const canMerge = MERGE_TYPES.has(file.file_type) &&
                   file.deploy_target_path &&
                   file.deploy_status !== 'deployed' &&
                   file.merge_status   !== 'merged'

  const isCompiledScript = file.file_type === 'db_script' && file.original_filename === 'compiled_scripts.txt'

  const statusKey = file.merge_status === 'merged' ? 'merged' : (file.deploy_status || 'pending')

  return (
    <div className={`patch-file-row status-file-${file.deploy_status || 'pending'}`}>
      <span className={`type-badge type-${file.file_type}`}>
        {FILE_TYPE_LABEL[file.file_type] || file.file_type}
      </span>
      <span className="patch-file-name">{file.original_filename}</span>
      {file.deploy_target_path && (
        <code className="patch-file-path">{file.deploy_target_path}</code>
      )}
      {!file.deploy_target_path &&
        file.file_type !== 'db_script' &&
        file.file_type !== 'reference' &&
        file.file_type !== 'gias_patch' && (
        <span className="patch-file-no-path">no path set</span>
      )}
      <span className={`status-badge status-${statusKey}`}>
        {STATUS_LABELS[statusKey] || statusKey}
      </span>
      {isCompiledScript && (
        <button
          className="btn btn-script-view btn-sm"
          onClick={e => { e.stopPropagation(); onViewScript(file) }}
        >
          View Script
        </button>
      )}
      {canMerge && (
        <button
          className="btn btn-secondary btn-sm file-merge-btn"
          onClick={e => { e.stopPropagation(); onMerge(file) }}
        >
          Preview Merge
        </button>
      )}
    </div>
  )
}

export default function PatchRow({ patch, onOpenFolder, onMerge, onDeploy, onDelete, onViewScript, selected, onToggleSelect }) {
  const [expanded, setExpanded] = useState(false)
  const files = patch.files || []

  const hasWarning = files.some(
    f => !f.deploy_target_path &&
         f.deploy_status === 'pending' &&
         f.file_type !== 'db_script' &&
         f.file_type !== 'reference' &&
         f.file_type !== 'gias_patch'
  )

  const allDone = files.length > 0 && files.every(
    f => f.deploy_status === 'deployed' || f.deploy_status === 'skipped' || f.merge_status === 'merged'
  )

  // Find compiled script file to show View Script button in header
  const compiledScript = files.find(
    f => f.file_type === 'db_script' && f.original_filename === 'compiled_scripts.txt'
  )

  const fileTypeSummary = [...new Set(files.map(f => f.file_type))]
    .map(t => FILE_TYPE_LABEL[t] || t)
    .join(' · ')

  const dateStr = patch.email_date
    ? new Date(patch.email_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const patchStatusLabel = PATCH_STATUS_LABELS[patch.status] || patch.status

  function handleDelete(e) {
    e.stopPropagation()
    onDelete(patch.id)
  }

  return (
    <div className={`patch-row${expanded ? ' expanded' : ''}${selected ? ' patch-row-selected' : ''}`}>
      <div className="patch-row-header" onClick={() => setExpanded(e => !e)}>
        {onToggleSelect && (
          <input
            type="checkbox"
            className="patch-select-cb"
            checked={!!selected}
            onClick={e => e.stopPropagation()}
            onChange={() => onToggleSelect(patch.id)}
          />
        )}
        <span className="patch-row-chevron">{expanded ? '▾' : '▸'}</span>

        <div className="patch-row-main">
          <span className="patch-row-subject">{patch.email_subject || '(no subject)'}</span>
          {patch.ticket_ref && <span className="patch-ticket-ref">{patch.ticket_ref}</span>}
          {hasWarning && <span className="patch-warn-icon" title="Some files need a deployment path">⚠</span>}
        </div>

        <div className="patch-row-meta">
          <span className="patch-file-types">{fileTypeSummary}</span>
          <span className="patch-file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
          <span className="patch-date">{dateStr}</span>
          {compiledScript && (
            <button
              className="btn btn-script-view btn-sm"
              title="View compiled SQL script"
              onClick={e => { e.stopPropagation(); onViewScript(compiledScript) }}
            >
              View Script
            </button>
          )}
          <span className={`status-badge status-${patch.status}`}>{patchStatusLabel}</span>
          {patch.status === 'staged' && (
            <button
              className="btn btn-ghost btn-sm patch-delete-btn"
              title="Delete patch"
              onClick={handleDelete}
            >✕</button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="patch-row-body">
          <div className="patch-sender">{patch.email_sender}</div>
          <div className="patch-files-list">
            {files.map(f => (
              <FileRow
                key={f.id}
                file={f}
                onMerge={file => onMerge(file)}
                onViewScript={file => onViewScript(file)}
              />
            ))}
            {files.length === 0 && <div className="patch-no-files">No files</div>}
          </div>
          <div className="patch-row-actions">
            {patch.local_folder && (
              <button
                className="btn btn-secondary btn-sm icon-btn"
                onClick={() => onOpenFolder(patch.local_folder)}
              >
                <FolderIcon size={13} />
                Open Folder
              </button>
            )}
            {!allDone && (
              <button
                className="btn btn-primary btn-sm icon-btn"
                onClick={() => onDeploy(patch.id)}
              >
                <RocketIcon size={13} />
                Deploy…
              </button>
            )}
            {allDone && (
              <span className="patch-all-done">✓ All deployed</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
