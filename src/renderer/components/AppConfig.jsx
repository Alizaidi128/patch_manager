import { useState } from 'react'
import FolderPickerModal from './FolderPickerModal'

const DEPLOY_MODES = [
  { value: 'smb',          label: 'SMB / Local' },
  { value: 'sftp',         label: 'SFTP (Linux)' },
  { value: 'rdp_assisted', label: 'RDP-Assisted' }
]

function makeDefault() {
  return {
    name: '', is_active: 1,
    outlook_folder_path: '',
    deployment_mode: 'smb',
    server_host: '', server_port: 22,
    server_user: '', server_password: '', server_key_path: '',
    app_root_path: '', tomcat_service_name: '', smb_path: '',
    notes: ''
  }
}

export default function AppConfig({ app, onSaved, onDeleted, onCancel }) {
  const [form, setForm]               = useState(app ? { ...app } : makeDefault())
  const [showPicker, setShowPicker]   = useState(false)
  const [showPass, setShowPass]       = useState(false)
  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState(null)
  const [saving, setSaving]           = useState(false)
  const [alert, setAlert]             = useState(null)

  const isNew = !form.id

  function set(key, val) {
    setForm(p => ({ ...p, [key]: val }))
    setAlert(null)
  }

  async function browseKeyFile() {
    const p = await window.api.invoke('dialog:browse-file', {
      filters: [{ name: 'Key files', extensions: ['pem', 'ppk', 'key', 'rsa', '*'] }]
    })
    if (p) set('server_key_path', p)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const res = await window.api.invoke('app:test-connection', form)
    setTestResult(res)
    setTesting(false)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setAlert({ type: 'error', message: 'App name is required.' })
      return
    }
    if (!form.outlook_folder_path.trim()) {
      setAlert({ type: 'error', message: 'Outlook folder path is required.' })
      return
    }
    setSaving(true)
    try {
      const res = await window.api.invoke('app:save', form)
      onSaved({ ...form, id: res.id })
    } catch (e) {
      setAlert({ type: 'error', message: e.message || 'Save failed.' })
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${form.name}"?\n\nThis removes the app configuration. Patch history in the database will also be removed.`)) return
    try {
      await window.api.invoke('app:delete', form.id)
      onDeleted()
    } catch (e) {
      setAlert({ type: 'error', message: e.message })
    }
  }

  return (
    <div className="app-config-page">

      <div className="config-page-header">
        <span className="config-page-title">
          {isNew ? 'Add New App' : form.name}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>← Back</button>
      </div>

      {/* ── Identity ── */}
      <div className="settings-section">
        <h3>Identity</h3>

        <div className="form-group">
          <label>App Name *</label>
          <input
            type="text"
            className="form-control mono"
            style={{ maxWidth: 220 }}
            value={form.name}
            onChange={e => set('name', e.target.value.toUpperCase())}
            placeholder="CONVUAT"
            maxLength={40}
          />
          <p className="form-hint">Short uppercase identifier — must be unique.</p>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Status</label>
          <div className="radio-group">
            {[{ v: 1, label: '● Active' }, { v: 0, label: '○ Inactive' }].map(o => (
              <label key={o.v} className="radio-label">
                <input type="radio" checked={form.is_active === o.v} onChange={() => set('is_active', o.v)} />
                {o.label}
              </label>
            ))}
          </div>
          {form.is_active === 0 && (
            <p className="form-hint">Inactive apps are hidden from the workflow. History is preserved.</p>
          )}
        </div>
      </div>

      {/* ── Outlook Folder ── */}
      <div className="settings-section">
        <h3>Outlook Folder</h3>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Folder Path *</label>
          <div className="form-row">
            <input
              type="text"
              className="form-control mono"
              style={{ fontSize: 12 }}
              value={form.outlook_folder_path}
              onChange={e => set('outlook_folder_path', e.target.value)}
              placeholder="ali.haider@centegytechnologies.com/Inbox/Development Team/MEGA MERGE - Adamjee"
            />
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPicker(true)}>
              Browse
            </button>
          </div>
          <p className="form-hint">
            Include the account name as the first segment (browse to find it). Outlook must be open to browse.
          </p>
        </div>
      </div>

      {/* ── Deployment Mode ── */}
      <div className="settings-section">
        <h3>Deployment</h3>

        <div className="form-group">
          <label>Mode</label>
          <div className="tab-group">
            {DEPLOY_MODES.map(m => (
              <button
                key={m.value}
                className={`tab-btn${form.deployment_mode === m.value ? ' active' : ''}`}
                onClick={() => { set('deployment_mode', m.value); setTestResult(null) }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* SMB fields */}
        {form.deployment_mode === 'smb' && (
          <>
            <div className="form-group">
              <label>Network Share Path</label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.smb_path}
                onChange={e => set('smb_path', e.target.value)}
                placeholder="\\192.168.1.10\E$\apps\CONVUAT"
              />
              <p className="form-hint">UNC path to the app root on the server. Can also be a local path if on the same machine.</p>
            </div>

            <div className="form-group">
              <label>App Root Path <span className="label-note">(server-side, for log reference)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.app_root_path}
                onChange={e => set('app_root_path', e.target.value)}
                placeholder="E:\apps\CONVUAT"
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tomcat Service Name</label>
              <input
                type="text" className="form-control"
                style={{ maxWidth: 200 }}
                value={form.tomcat_service_name}
                onChange={e => set('tomcat_service_name', e.target.value)}
                placeholder="Tomcat9"
              />
              <p className="form-hint">
                Used for <code>net stop / net start</code> after deployment. Leave blank to skip Tomcat restart.
              </p>
            </div>
          </>
        )}

        {/* SFTP fields */}
        {form.deployment_mode === 'sftp' && (
          <>
            <div className="form-grid-2" style={{ marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Host</label>
                <input
                  type="text" className="form-control"
                  value={form.server_host}
                  onChange={e => set('server_host', e.target.value)}
                  placeholder="192.168.1.20"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Port</label>
                <input
                  type="number" className="form-control"
                  style={{ maxWidth: 90 }}
                  value={form.server_port}
                  onChange={e => set('server_port', parseInt(e.target.value, 10) || 22)}
                  min={1} max={65535}
                />
              </div>
            </div>

            <div className="form-grid-2" style={{ marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Username</label>
                <input
                  type="text" className="form-control"
                  value={form.server_user}
                  onChange={e => set('server_user', e.target.value)}
                  placeholder="deploy"
                  autoComplete="off"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Password</label>
                <div className="form-row">
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="form-control"
                    value={form.server_password}
                    onChange={e => set('server_password', e.target.value)}
                    autoComplete="new-password"
                    placeholder={form.server_key_path ? '(key auth)' : ''}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowPass(p => !p)}
                    title={showPass ? 'Hide' : 'Show'}
                    tabIndex={-1}
                  >{showPass ? '🙈' : '👁️'}</button>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>SSH Key Path <span className="label-note">(optional — overrides password)</span></label>
              <div className="form-row">
                <input
                  type="text" className="form-control mono" style={{ fontSize: 12 }}
                  value={form.server_key_path}
                  onChange={e => set('server_key_path', e.target.value)}
                  placeholder="C:\keys\server.pem"
                />
                <button className="btn btn-secondary btn-sm" onClick={browseKeyFile}>Browse</button>
              </div>
            </div>

            <div className="form-group">
              <label>App Root Path <span className="label-note">(on Linux server)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.app_root_path}
                onChange={e => set('app_root_path', e.target.value)}
                placeholder="/opt/tomcat/webapps/CONVUAT"
              />
            </div>

            <div className="test-connection-row">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleTest}
                disabled={testing || !form.server_host || !form.server_user}
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
              {testResult && (
                <span className={`test-result ${testResult.success ? 'ok' : 'fail'}`}>
                  {testResult.success ? '✅' : '❌'} {testResult.message}
                </span>
              )}
            </div>
          </>
        )}

        {/* RDP-Assisted fields */}
        {form.deployment_mode === 'rdp_assisted' && (
          <>
            <div className="form-group">
              <label>App Root Path <span className="label-note">(reference — used to structure staging folder)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.app_root_path}
                onChange={e => set('app_root_path', e.target.value)}
                placeholder="E:\apps\CONVUAT  or  /opt/tomcat/webapps/CONVUAT"
              />
            </div>
            <div className="alert alert-info" style={{ marginTop: 0 }}>
              Patch Manager prepares a local staging folder mirroring the app root, then opens it in Explorer.
              You RDP into the server, copy the files, restart Tomcat, then click "Mark as Deployed."
            </div>
          </>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="settings-section">
        <h3>Notes</h3>
        <textarea
          className="form-control"
          rows={3}
          value={form.notes || ''}
          onChange={e => set('notes', e.target.value)}
          placeholder="Server quirks, contacts, deployment notes…"
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* ── Actions ── */}
      <div className="config-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create App' : 'Save Changes'}
        </button>
        {!isNew && (
          <button className="btn btn-danger" onClick={handleDelete}>
            Delete App
          </button>
        )}
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type}`} style={{ marginTop: 14, maxWidth: 520 }}>
          {alert.message}
        </div>
      )}

      {showPicker && (
        <FolderPickerModal
          currentPath={form.outlook_folder_path}
          onSelect={p => set('outlook_folder_path', p)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
