import { useState, useEffect } from 'react'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [alert, setAlert] = useState(null) // { type, message }

  useEffect(() => {
    window.api.invoke('settings:get').then(s => setSettings(s || {}))
  }, [])

  function set(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  async function handleBrowse() {
    const folder = await window.api.invoke('dialog:browse-folder', settings.patches_root_dir)
    if (folder) set('patches_root_dir', folder)
  }

  async function handleOpenFolder() {
    if (settings.patches_root_dir) {
      await window.api.invoke('shell:open-folder', settings.patches_root_dir)
    }
  }

  async function handleSave() {
    try {
      await window.api.invoke('settings:save', settings)
      showAlert('success', 'Settings saved successfully.')
    } catch (e) {
      showAlert('error', e.message || 'Failed to save settings.')
    }
  }

  function showAlert(type, message) {
    setAlert({ type, message })
    setTimeout(() => setAlert(null), 4000)
  }

  if (!settings) {
    return (
      <div className="settings-page">
        <p style={{ color: '#666' }}>Loading settings…</p>
      </div>
    )
  }

  return (
    <div className="settings-page">

      {/* Storage */}
      <div className="settings-section">
        <h3>Storage</h3>

        <div className="form-group">
          <label>Patches Root Directory</label>
          <div className="form-row">
            <input
              type="text"
              className="form-control"
              value={settings.patches_root_dir || ''}
              onChange={e => set('patches_root_dir', e.target.value)}
              placeholder="D:\Office\Patches_automated"
            />
            <button className="btn btn-secondary btn-sm" onClick={handleBrowse}>Browse</button>
            <button className="btn btn-secondary btn-sm" onClick={handleOpenFolder} title="Open in Explorer">📂</button>
          </div>
          <p className="form-hint">
            Patches are saved here as <code>MMM-DD-YYYY\{'{n}'}\</code> — one numbered folder per email.
          </p>
        </div>
      </div>

      {/* Outlook */}
      <div className="settings-section">
        <h3>Outlook</h3>

        <div className="form-group">
          <label className="toggle-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.outlook_poll_on_startup === '1'}
              onChange={e => set('outlook_poll_on_startup', e.target.checked ? '1' : '0')}
            />
            <span className="toggle-text">
              <strong>Auto-fetch on startup</strong>
              <span>Fetch new patches from Outlook each time Patch Manager opens. Outlook must already be running.</span>
            </span>
          </label>
        </div>

        <div className="alert alert-info" style={{ marginTop: 0 }}>
          Outlook polling is manual-only — no background timers. All fetching and deployment is triggered by you.
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
        <button className="btn btn-secondary" onClick={() => window.api.invoke('updater:check')}>
          Check for Updates
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
          v{window.api?.appVersion || '—'}
        </span>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type}`}>
          {alert.message}
        </div>
      )}
    </div>
  )
}
