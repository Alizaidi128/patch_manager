import { useState, useEffect } from 'react'

const FILE_TYPE_LABEL = {
  gias_patch:  'GIAS',
  jsp:         'JSP',
  xml_merge:   'XML',
  props_merge: 'Props',
  db_script:   'SQL',
  reference:   'Ref',
  unknown:     '?',
}

export default function DeployDialog({ patchId, onClose, onDeployed }) {
  const [step, setStep]       = useState('loading') // loading | preview | running | done | error
  const [data, setData]       = useState(null)       // previewDeploy result
  const [selected, setSelected] = useState([])       // selected file IDs
  const [restart, setRestart] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError]     = useState(null)
  const [showCred, setShowCred] = useState(false)    // credential hint expanded

  useEffect(() => {
    window.api.invoke('deploy:preview', { patchId })
      .then(d => {
        setData(d)
        // Pre-select all deployable files
        setSelected(d.deployable.map(f => f.id))
        setStep('preview')
      })
      .catch(e => { setError(e.message); setStep('error') })
  }, [patchId])

  const isRdp = false // RDP-Assisted now deploys like SMB — no manual mode

  function toggleFile(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAll() {
    const ids = (data?.deployable || []).map(f => f.id)
    setSelected(prev => prev.length === ids.length ? [] : ids)
  }

  async function handleDeploy() {
    setStep('running')
    try {
      const res = await window.api.invoke('deploy:execute', { patchId, fileIds: selected, restartTomcat: restart })
      setResults(res)
      setStep('done')
    } catch (e) {
      setError(e.message)
      setStep('error')
    }
  }

  async function handleMarkManual() {
    setStep('running')
    try {
      await window.api.invoke('deploy:mark-manual', { patchId, fileIds: selected })
      setResults({ results: selected.map(id => {
        const f = data.deployable.find(x => x.id === id)
        return { id, filename: f?.original_filename, success: true, manual: true }
      }), tomcatResult: null })
      setStep('done')
    } catch (e) {
      setError(e.message)
      setStep('error')
    }
  }

  function handleClose() {
    if (step === 'done') onDeployed()
    onClose()
  }

  const deployableCount = (data?.deployable || []).length

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && step !== 'running' && handleClose()}>
      <div className="modal modal-lg deploy-modal">
        <div className="modal-header">
          <h3>
            {isRdp ? '🖥 Manual Deployment' : '🚀 Deploy Patch'}
            {data?.patch && <span className="deploy-modal-subject"> — {data.patch.email_subject?.slice(0, 50)}</span>}
          </h3>
          {step !== 'running' && (
            <button className="modal-close" onClick={handleClose}>✕</button>
          )}
        </div>

        <div className="modal-body deploy-modal-body">

          {step === 'loading' && (
            <div className="merge-loading">
              <div className="fetch-spinner" />
              <span>Building deployment plan…</span>
            </div>
          )}

          {step === 'preview' && data?.blockedBy?.length > 0 && (
            <div className="deploy-blocked">
              <div className="deploy-blocked-icon">🔒</div>
              <div className="deploy-blocked-title">Deploy blocked — older patches must be deployed first</div>
              <div className="deploy-blocked-list">
                {data.blockedBy.map(p => (
                  <div key={p.id} className="deploy-blocked-item">
                    <span className={`status-badge status-${p.status}`}>{p.status}</span>
                    <span className="deploy-blocked-subject">{p.email_subject || '(no subject)'}</span>
                    <span className="deploy-blocked-date">
                      {p.email_date ? new Date(p.email_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="merge-error">
              <div className="merge-error-icon">✕</div>
              <div className="merge-error-msg">{error}</div>
            </div>
          )}

          {step === 'running' && (
            <div className="fetch-running">
              <div className="fetch-spinner" />
              <div className="fetch-running-text">
                {isRdp ? 'Marking files as deployed…' : 'Deploying files…'}
              </div>
              {!isRdp && <div className="fetch-running-hint">Do not close the app.</div>}
            </div>
          )}

          {(step === 'preview') && data && (
            <>
              {/* RDP instructions */}
              {isRdp && (
                <div className="rdp-instructions">
                  <div className="rdp-instructions-title">Connect to {data.app.server_host} via RDP and copy these files:</div>
                </div>
              )}

              {/* Credential hint — RDP-Assisted only */}
              {data?.credentialHint && (
                <div className="cred-hint-panel">
                  <div className="cred-hint-header" onClick={() => setShowCred(p => !p)}>
                    <span>🔑 Network credentials for copy-paste into Windows prompts</span>
                    <span>{showCred ? '▲' : '▼'}</span>
                  </div>
                  {showCred && (
                    <div className="cred-hint-body">
                      <div className="cred-hint-row">
                        <span className="cred-hint-label">Username</span>
                        <span className="cred-hint-value mono">{data.credentialHint.user}</span>
                        <button className="copy-btn" onClick={() => navigator.clipboard.writeText(data.credentialHint.user)}>⧉</button>
                      </div>
                      <div className="cred-hint-row">
                        <span className="cred-hint-label">Password</span>
                        <span className="cred-hint-value mono">{'•'.repeat(Math.min((data.credentialHint.password || '').length, 20))}</span>
                        <button className="copy-btn" onClick={() => navigator.clipboard.writeText(data.credentialHint.password)}>⧉ Copy</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* App / mode info */}
              <div className="deploy-info-bar">
                <span className="deploy-info-item">
                  <span className="deploy-info-label">App</span> {data.app.name}
                </span>
                <span className="deploy-info-item">
                  <span className="deploy-info-label">Mode</span>
                  <span className={`deploy-mode-badge mode-${data.app.deployment_mode}`}>
                    {data.app.deployment_mode?.toUpperCase()}
                  </span>
                </span>
                {data.app.deployment_mode === 'sftp' && (
                  <span className="deploy-info-item">
                    <span className="deploy-info-label">Host</span> {data.app.server_host}
                  </span>
                )}
              </div>

              {/* Deployable files */}
              {deployableCount > 0 && (
                <div className="deploy-section">
                  <div className="deploy-section-header">
                    <label className="deploy-select-all">
                      <input
                        type="checkbox"
                        checked={selected.length === deployableCount}
                        onChange={toggleAll}
                      />
                      <span>{deployableCount} file{deployableCount !== 1 ? 's' : ''} to deploy</span>
                    </label>
                  </div>
                  <div className="deploy-file-list">
                    {data.deployable.map(f => (
                      <label key={f.id} className={`deploy-file-item${selected.includes(f.id) ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected.includes(f.id)}
                          onChange={() => toggleFile(f.id)}
                        />
                        <span className={`type-badge type-${f.file_type}`}>
                          {FILE_TYPE_LABEL[f.file_type] || f.file_type}
                        </span>
                        <span className="deploy-file-name">{f.original_filename}</span>
                        {f.file_type === 'gias_patch' ? (
                          <span className="deploy-file-dest">→ {f.deployBase} ({f.subFiles?.length} files)</span>
                        ) : (
                          <span className="deploy-file-dest">→ {f.deploy_target_path}</span>
                        )}
                        {f.note && <span className="deploy-file-note">{f.note}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {deployableCount === 0 && (
                <div className="deploy-empty">
                  <div className="deploy-empty-icon">✓</div>
                  <div>All files are already deployed or merged.</div>
                </div>
              )}

              {/* Non-deployable info */}
              {data.nonDeployable.length > 0 && (
                <div className="deploy-section deploy-section-info">
                  <div className="deploy-section-header-plain">
                    {data.nonDeployable.length} file{data.nonDeployable.length !== 1 ? 's' : ''} excluded
                  </div>
                  <div className="deploy-info-list">
                    {data.nonDeployable.map(f => (
                      <div key={f.id} className="deploy-info-item-row">
                        <span className={`type-badge type-${f.file_type}`}>
                          {FILE_TYPE_LABEL[f.file_type] || f.file_type}
                        </span>
                        <span className="deploy-info-filename">{f.original_filename}</span>
                        <span className="deploy-info-reason">{f.reason}</span>
                        {f.canForce && (
                          <label className="force-redeploy-check" title="Force re-deploy this file">
                            <input
                              type="checkbox"
                              checked={selected.includes(f.id)}
                              onChange={() => toggleFile(f.id)}
                            />
                            <span>Re-deploy</span>
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tomcat restart */}
              {data.tomcatAvailable && !isRdp && (
                <div className="deploy-tomcat-row">
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={restart}
                      onChange={e => setRestart(e.target.checked)}
                    />
                    <div className="toggle-text">
                      <strong>Restart Tomcat after deploy</strong>
                      <span>Service: {data.app.tomcat_service_name}</span>
                    </div>
                  </label>
                </div>
              )}
            </>
          )}

          {step === 'done' && results && (
            <div className="deploy-results">
              {results.results.map(r => (
                <div key={r.id} className={`deploy-result-row ${r.success ? 'ok' : 'fail'}`}>
                  <span className="deploy-result-icon">{r.success ? '✓' : '✕'}</span>
                  <span className="deploy-result-name">{r.filename}</span>
                  {r.manual && <span className="deploy-result-note">marked as deployed</span>}
                  {r.dest && <span className="deploy-result-note" title={r.dest}>→ {r.dest}</span>}
                  {r.error && <span className="deploy-result-error">{r.error}</span>}
                </div>
              ))}
              {results.tomcatResult && (
                <div className={`deploy-result-row ${results.tomcatResult.success ? 'ok' : 'fail'} tomcat-row`}>
                  <span className="deploy-result-icon">{results.tomcatResult.success ? '✓' : '✕'}</span>
                  <span>Tomcat: {results.tomcatResult.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'preview' && data?.blockedBy?.length > 0 && (
            <button className="btn btn-primary" onClick={handleClose}>Close</button>
          )}

          {step === 'preview' && !data?.blockedBy?.length && (
            <>
              <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
              {isRdp ? (
                <button
                  className="btn btn-primary"
                  onClick={handleMarkManual}
                  disabled={!selected.length}
                >
                  Mark as Deployed
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleDeploy}
                  disabled={!selected.length}
                >
                  Deploy {selected.length} File{selected.length !== 1 ? 's' : ''}
                  {restart ? ' + Restart Tomcat' : ''}
                </button>
              )}
            </>
          )}
          {(step === 'done' || step === 'error') && (
            <button className="btn btn-primary" onClick={handleClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
