import { useState, useEffect } from 'react'
import { CopyIcon, CheckIcon, DownloadIcon, XIcon } from '../icons.jsx'

// patchFile  = single file record (row-level view)
// patchFiles = array of { file, patchSubject } (toolbar master view)
export default function ScriptViewModal({ patchFile, patchFiles, onClose }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  const isMulti = !!patchFiles && patchFiles.length > 0

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      if (isMulti) {
        const parts = []
        const errors = []
        for (const { file, patchSubject } of patchFiles) {
          const res = await window.api.invoke('patch:read-script', { localPath: file.local_path })
          if (res.success) {
            parts.push(`-- ===== ${patchSubject || file.original_filename} =====\n${res.content}`)
          } else {
            errors.push(`${patchSubject}: ${res.error}`)
          }
        }
        if (parts.length) setContent(parts.join('\n\n'))
        if (errors.length) setError(errors.join('\n'))
      } else {
        const res = await window.api.invoke('patch:read-script', { localPath: patchFile.local_path })
        if (res.success) setContent(res.content)
        else setError(res.error)
      }

      setLoading(false)
    }
    load()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy() {
    if (!content) return
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  function handleOpen() {
    if (isMulti) {
      window.api.invoke('patch:open-content', {
        content,
        filename: `compiled_scripts_${Date.now()}.sql`
      })
    } else {
      window.api.invoke('patch:open-script', { localPath: patchFile.local_path })
    }
  }

  const title = isMulti
    ? `${patchFiles.length} compiled script${patchFiles.length !== 1 ? 's' : ''} (selected patches)`
    : patchFile.original_filename

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal script-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="script-modal-title">
            <span className="type-badge type-db_script" style={{ marginRight: 8 }}>SQL</span>
            {title}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm icon-btn"
              onClick={handleCopy}
              disabled={!content}
              title="Copy all to clipboard"
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              {copied ? 'Copied!' : 'Copy All'}
            </button>
            <button
              className="btn btn-secondary btn-sm icon-btn"
              onClick={handleOpen}
              disabled={!content}
              title="Open with default editor"
            >
              <DownloadIcon size={13} />
              Open File
            </button>
            <button className="modal-close icon-btn" onClick={onClose}>
              <XIcon size={14} />
            </button>
          </div>
        </div>

        <div className="script-modal-body">
          {loading && (
            <div className="script-modal-loading">Loading script{isMulti ? 's' : ''}…</div>
          )}
          {error && !content && (
            <div className="script-modal-error">Error reading file: {error}</div>
          )}
          {error && content && (
            <div className="script-modal-error" style={{ marginBottom: 8 }}>Some files failed to load: {error}</div>
          )}
          {content && (
            <pre className="script-modal-code">{content}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
