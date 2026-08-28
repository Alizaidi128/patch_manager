import { useState, useEffect } from 'react'

export default function UpdateBanner() {
  const [state, setState] = useState(null)
  // state shape: { phase: 'available'|'downloading'|'downloaded'|'error'|'checking', version?, percent?, message? }

  useEffect(() => {
    const off = [
      window.api.on('updater:available',     d => setState({ phase: 'available',    version: d.version })),
      window.api.on('updater:progress',      d => setState(s => ({ ...s, phase: 'downloading', percent: d.percent }))),
      window.api.on('updater:downloaded',    d => setState({ phase: 'downloaded',   version: d.version })),
      window.api.on('updater:error',         d => setState({ phase: 'error',        message: d.message })),
      window.api.on('updater:not-available', () => setState(null)),
      window.api.on('updater:checking',      () => setState({ phase: 'checking' })),
    ]
    return () => off.forEach(fn => fn())
  }, [])

  if (!state) return null

  function dismiss() { setState(null) }

  function download() {
    setState(s => ({ ...s, phase: 'downloading', percent: 0 }))
    window.api.invoke('updater:download').catch(e => setState({ phase: 'error', message: e.message }))
  }

  function install() {
    window.api.invoke('updater:install')
  }

  const { phase, version, percent, message } = state

  return (
    <div className="update-banner">
      {phase === 'checking' && (
        <span className="update-banner-text">Checking for updates…</span>
      )}

      {phase === 'available' && (
        <>
          <span className="update-banner-text">
            <strong>v{version}</strong> is available
          </span>
          <button className="btn btn-primary btn-sm" onClick={download}>Download</button>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Later</button>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <span className="update-banner-text">Downloading update… {percent}%</span>
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}

      {phase === 'downloaded' && (
        <>
          <span className="update-banner-text">
            <strong>v{version}</strong> ready — restart to install
          </span>
          <button className="btn btn-primary btn-sm" onClick={install}>Restart &amp; Install</button>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Later</button>
        </>
      )}

      {phase === 'error' && (
        <>
          <span className="update-banner-text update-banner-error">Update error: {message}</span>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>✕</button>
        </>
      )}
    </div>
  )
}
