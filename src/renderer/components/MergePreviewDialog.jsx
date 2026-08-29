import { useState, useEffect } from 'react'

export default function MergePreviewDialog({ patchFileId, onClose, onApplied }) {
  const [state, setState]         = useState('loading') // loading | ready | applying | done | error
  const [preview, setPreview]     = useState(null)
  const [errorMsg, setErrorMsg]   = useState(null)
  const [showMerged, setShowMerged] = useState(false)

  useEffect(() => {
    window.api.invoke('merge:preview', { patchFileId })
      .then(p  => { setPreview(p);        setState('ready') })
      .catch(e => { setErrorMsg(e.message); setState('error') })
  }, [patchFileId])

  async function handleApply() {
    setState('applying')
    try {
      await window.api.invoke('merge:apply', { patchFileId, mergedContent: preview.mergedContent })
      setState('done')
    } catch (e) {
      setErrorMsg(e.message)
      setState('error')
    }
  }

  function handleClose() {
    if (state === 'done') onApplied()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && state !== 'applying' && handleClose()}>
      <div className="modal modal-lg merge-modal">
        <div className="modal-header">
          <h3>
            {preview?.fileType === 'xml_merge' ? '⚙ XML Merge Preview' : '⚙ Properties Merge Preview'}
            {preview && <span className="merge-modal-filename"> — {preview.filename}</span>}
          </h3>
          {state !== 'applying' && (
            <button className="modal-close" onClick={handleClose}>✕</button>
          )}
        </div>

        <div className="modal-body merge-modal-body">

          {state === 'loading' && (
            <div className="merge-loading">
              <div className="fetch-spinner" />
              <span>Reading file from server…</span>
            </div>
          )}

          {state === 'error' && (
            <div className="merge-error">
              <div className="merge-error-icon">✕</div>
              <div className="merge-error-msg">{errorMsg}</div>
            </div>
          )}

          {(state === 'ready' || state === 'applying' || state === 'done') && preview && (
            <>
              <div className="merge-target-path">
                <span className="merge-path-label">Target file</span>
                <code className="merge-path-value">{preview.deployPath}</code>
              </div>

              {state === 'done' && (
                <div className="merge-done-banner">
                  ✓ Merge applied successfully and backed up original.
                </div>
              )}

              {preview.fileType === 'xml_merge'
                ? <XmlPreviewSections preview={preview} />
                : <PropsPreviewSections preview={preview} />
              }

              <div className="merge-merged-toggle">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowMerged(s => !s)}
                >
                  {showMerged ? 'Hide' : 'Show'} merged result
                </button>
              </div>

              {showMerged && (
                <pre className="merge-result-preview">{preview.mergedContent}</pre>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose} disabled={state === 'applying'}>
            {state === 'done' ? 'Close' : 'Cancel'}
          </button>
          {state === 'ready' && preview?.hasChanges && (
            <button className="btn btn-primary" onClick={handleApply}>
              Apply Merge
            </button>
          )}
          {state === 'ready' && !preview?.hasChanges && (
            <span className="merge-no-changes-note">Nothing to merge — server file is already up to date.</span>
          )}
          {state === 'applying' && (
            <button className="btn btn-primary" disabled>Applying…</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- XML section renderers ----

function XmlPreviewSections({ preview }) {
  const addCount  = (preview.toAdd?.servlets?.length || 0) + (preview.toAdd?.mappings?.length || 0)
  const skipCount = (preview.alreadyPresent?.servlets?.length || 0) + (preview.alreadyPresent?.mappings?.length || 0)

  return (
    <div className="merge-sections">
      <div className="merge-section">
        <div className="merge-section-header add">
          <span className="merge-section-icon">+</span>
          <span>{addCount} entr{addCount !== 1 ? 'ies' : 'y'} to add</span>
        </div>
        {addCount === 0
          ? <div className="merge-empty">Nothing to add — all entries already present.</div>
          : (
            <div className="merge-block-list">
              {preview.toAdd?.servlets?.map((s, i) => (
                <XmlBlock key={`srv-${i}`} label="servlet" name={s.name} raw={s.raw} />
              ))}
              {preview.toAdd?.mappings?.map((s, i) => (
                <XmlBlock key={`map-${i}`} label="servlet-mapping" name={s.name} raw={s.raw} />
              ))}
            </div>
          )
        }
      </div>

      {skipCount > 0 && (
        <div className="merge-section">
          <div className="merge-section-header skip">
            <span className="merge-section-icon">↷</span>
            <span>{skipCount} entr{skipCount !== 1 ? 'ies' : 'y'} already present (will be skipped)</span>
          </div>
          <div className="merge-block-list">
            {preview.alreadyPresent?.servlets?.map((s, i) => (
              <div key={`es-${i}`} className="merge-skip-item">{s.name}</div>
            ))}
            {preview.alreadyPresent?.mappings?.map((s, i) => (
              <div key={`em-${i}`} className="merge-skip-item">{s.name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function XmlBlock({ label, name, raw }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="merge-xml-block">
      <div className="merge-xml-block-header" onClick={() => setOpen(o => !o)}>
        <span className="merge-xml-chevron">{open ? '▾' : '▸'}</span>
        <span className="merge-xml-label">&lt;{label}&gt;</span>
        <span className="merge-xml-name">{name}</span>
      </div>
      {open && <pre className="merge-xml-raw">{raw.trim()}</pre>}
    </div>
  )
}

// ---- Props section renderers ----

function PropsPreviewSections({ preview }) {
  const addCount  = preview.toAdd?.length || 0
  const skipCount = preview.alreadyPresent?.length || 0

  return (
    <div className="merge-sections">
      <div className="merge-section">
        <div className="merge-section-header add">
          <span className="merge-section-icon">+</span>
          <span>{addCount} propert{addCount !== 1 ? 'ies' : 'y'} to add</span>
        </div>
        {addCount === 0
          ? <div className="merge-empty">Nothing to add — all properties already present.</div>
          : (
            <div className="merge-props-list">
              {preview.toAdd.map((e, i) => (
                <div key={i} className="merge-prop-row add">
                  <span className="merge-prop-key">{e.key}</span>
                  <span className="merge-prop-val">{e.line.slice(e.key.length)}</span>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {skipCount > 0 && (
        <div className="merge-section">
          <div className="merge-section-header skip">
            <span className="merge-section-icon">↷</span>
            <span>{skipCount} propert{skipCount !== 1 ? 'ies' : 'y'} already present</span>
          </div>
          <div className="merge-props-list">
            {preview.alreadyPresent.map((e, i) => (
              <div key={i} className="merge-prop-row skip">
                <span className="merge-prop-key">{e.key}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
