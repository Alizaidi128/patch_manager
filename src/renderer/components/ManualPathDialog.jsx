import { useState } from 'react'

const TYPE_LABEL = {
  jsp:        'JSP File',
  xml_merge:  'XML Merge',
  props_merge:'Properties Merge',
}

export default function ManualPathDialog({ items, onClose, onComplete }) {
  // items: [{patchFileId, appName, filename, fileType, emailSubject, emailBody, detectedPath, confidence}]
  const [index, setIndex]   = useState(0)
  const [paths, setPaths]   = useState(() => items.map(i => i.detectedPath || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const current = items[index]
  const total   = items.length

  async function skipCurrent() {
    try {
      await window.api.invoke('patch:skip', { patchFileId: current.patchFileId })
      advance()
    } catch (e) {
      setError(e.message)
    }
  }

  async function saveCurrent() {
    const p = paths[index].trim()
    if (!p) return
    setSaving(true)
    setError(null)
    try {
      await window.api.invoke('patch:set-path', { patchFileId: current.patchFileId, deployPath: p })
      advance()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function advance() {
    if (index < total - 1) {
      setIndex(index + 1)
      setError(null)
    } else {
      onComplete()
      onClose()
    }
  }

  function setPath(val) {
    setPaths(prev => prev.map((p, i) => i === index ? val : p))
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Set Deployment Path — {index + 1} of {total}</h3>
          <button className="modal-close" onClick={onClose} title="Skip all remaining">✕</button>
        </div>

        <div className="modal-body manual-path-body">
          <div className="mp-meta">
            <div className="mp-meta-row">
              <span className="mp-meta-label">App</span>
              <span className="mp-meta-value">{current.appName}</span>
            </div>
            <div className="mp-meta-row">
              <span className="mp-meta-label">File</span>
              <span className="mp-meta-value mono">{current.filename}</span>
            </div>
            <div className="mp-meta-row">
              <span className="mp-meta-label">Type</span>
              <span className="mp-meta-value">
                <span className={`type-badge type-${current.fileType}`}>
                  {TYPE_LABEL[current.fileType] || current.fileType}
                </span>
              </span>
            </div>
            {current.emailSubject && (
              <div className="mp-meta-row">
                <span className="mp-meta-label">Subject</span>
                <span className="mp-meta-value">{current.emailSubject}</span>
              </div>
            )}
            {current.detectedPath && (
              <div className="mp-meta-row">
                <span className="mp-meta-label">Detected</span>
                <span className="mp-meta-value">
                  <span className={`confidence-badge conf-${current.confidence}`}>{current.confidence}</span>
                  {' '}<code className="path-code">{current.detectedPath}</code>
                </span>
              </div>
            )}
          </div>

          {current.emailBody && (
            <div className="mp-body-preview">
              <div className="mp-body-label">Email body excerpt</div>
              <pre className="mp-body-text">{current.emailBody}</pre>
            </div>
          )}

          <div className="mp-input-section">
            <label className="mp-input-label">
              Deployment path on server
              <span className="label-note"> — e.g. /opt/tomcat/webapps/ROOT/WEB-INF/</span>
            </label>
            <input
              type="text"
              className="form-control mono"
              placeholder="/opt/tomcat/webapps/ROOT/..."
              value={paths[index]}
              onChange={e => setPath(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && paths[index].trim()) saveCurrent() }}
            />
          </div>

          {error && <div className="alert alert-error" style={{ margin: '0 16px 8px' }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={skipCurrent} disabled={saving}>
            Skip
          </button>
          <button
            className="btn btn-primary"
            onClick={saveCurrent}
            disabled={!paths[index]?.trim() || saving}
          >
            {saving ? 'Saving…' : index < total - 1 ? 'Save & Next' : 'Save & Finish'}
          </button>
        </div>
      </div>
    </div>
  )
}
