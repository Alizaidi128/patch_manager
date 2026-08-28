import { useState, useCallback } from 'react'
import FolderPickerModal from './FolderPickerModal'

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])
  return (
    <button className="copy-btn" onClick={copy} title="Copy to clipboard" type="button">
      {copied ? '✓' : '⧉'}
    </button>
  )
}

function CredField({ label, value, onChange, type = 'text', placeholder = '', hint, readOnly = false, mono = false, canCopy = false }) {
  const [showPwd, setShowPwd] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="cred-field">
      <div className="cred-field-label">{label}</div>
      <div className="cred-field-row">
        <input
          type={isPassword && !showPwd ? 'password' : 'text'}
          className={`form-control cred-input${mono ? ' mono' : ''}`}
          value={value || ''}
          onChange={onChange ? e => onChange(e.target.value) : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete="new-password"
          style={{ fontSize: 12 }}
        />
        {isPassword && (
          <button className="copy-btn" onClick={() => setShowPwd(p => !p)} title={showPwd ? 'Hide' : 'Show'} type="button">
            {showPwd ? '🙈' : '👁️'}
          </button>
        )}
        {canCopy && <CopyBtn value={value} />}
      </div>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  )
}

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
    local_src_path: '', war_name: '', remote_war_path: '', tomcat_remote_path: '',
    sftp_server_path: '', patch_path: '',
    notes: ''
  }
}

export default function AppConfig({ app, onSaved, onDeleted, onCancel }) {
  const [form, setForm]               = useState(app ? { ...app } : makeDefault())
  const [showPicker, setShowPicker]   = useState(false)
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
                onClick={() => {
                set('deployment_mode', m.value)
                setTestResult(null)
                if (m.value === 'rdp_assisted' && (!form.server_port || form.server_port === 22)) set('server_port', 3389)
                if (m.value === 'sftp' && (!form.server_port || form.server_port === 3389)) set('server_port', 22)
              }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* SMB / Local (Windows) fields */}
        {form.deployment_mode === 'smb' && (
          <>
            <div className="form-group">
              <label>App Folder Path</label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.smb_path}
                onChange={e => set('smb_path', e.target.value)}
                placeholder="D:\apps\CONVUAT  or  \\server\E$\apps\CONVUAT"
              />
              <p className="form-hint">
                Path to the app folder on this machine. Use a local path (e.g. <code>D:\apps\CONVUAT</code>) when
                Patch Manager runs on the server itself, or a UNC path if deploying over the network.
              </p>
            </div>

            <div className="form-group">
              <label>Patch Path <span className="label-note">(optional)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.patch_path || ''}
                onChange={e => set('patch_path', e.target.value)}
                placeholder="D:\Patches_automated"
              />
              <p className="form-hint">
                Where fetched patches are saved for this app. Overrides the global patch root from Settings.
                Leave blank to use the global setting.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tomcat Service Name <span className="label-note">(optional)</span></label>
              <input
                type="text" className="form-control"
                style={{ maxWidth: 200 }}
                value={form.tomcat_service_name}
                onChange={e => set('tomcat_service_name', e.target.value)}
                placeholder="Tomcat9"
              />
              <p className="form-hint">
                Windows service name. "Restart Tomcat" runs <code>net stop</code> then <code>net start</code> locally.
                Leave blank to skip Tomcat restart.
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

            <div className="cred-card">
              <div className="cred-card-title">SERVER — LINUX / SFTP (WINSCP)</div>
              <div className="form-grid-2" style={{ marginBottom: 0 }}>
                <CredField label="USERNAME"
                  value={form.server_user}
                  onChange={v => set('server_user', v)}
                  placeholder="deploy"
                  canCopy
                />
                <CredField label="PASSWORD"
                  value={form.server_password}
                  onChange={v => set('server_password', v)}
                  type="password"
                  placeholder={form.server_key_path ? '(key auth)' : ''}
                  canCopy
                />
              </div>
              <CredField
                label={<>SFTP SERVER <span className="label-note">(optional)</span></>}
                value={form.sftp_server_path}
                onChange={v => set('sftp_server_path', v)}
                placeholder="sudo /usr/libexec/openssh/sftp-server"
                mono
                canCopy
                hint="Leave blank for standard SFTP. Set only if the server requires a custom sftp-server binary path (shown in WinSCP advanced settings)."
              />
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
              <label>App Root Path <span className="label-note">(on Linux server — also used as WAR destination)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.app_root_path}
                onChange={e => set('app_root_path', e.target.value)}
                placeholder="/u01/opt/APP_TEST"
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

        {/* WAR Deploy fields — SFTP only */}
        {form.deployment_mode === 'sftp' && (
          <div className="settings-subsection">
            <h4>WAR Deployment</h4>
            <p className="form-hint" style={{ marginBottom: 12 }}>
              Patch files are copied into the Local Source Folder below. "Deploy WAR" zips it and uploads to App Root Path on the Linux server.
            </p>

            <div className="form-group">
              <label>Local Source Folder</label>
              <div className="form-row">
                <input
                  type="text" className="form-control mono" style={{ fontSize: 12 }}
                  value={form.local_src_path || ''}
                  onChange={e => set('local_src_path', e.target.value)}
                  placeholder="D:\Office\APPS\CONVUAT"
                />
                <button className="btn btn-secondary btn-sm" onClick={async () => {
                  const p = await window.api.invoke('dialog:browse-folder')
                  if (p) set('local_src_path', p)
                }}>Browse</button>
              </div>
              <p className="form-hint">Local Windows folder whose contents are zipped into the WAR.</p>
            </div>

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>WAR Name</label>
              <input
                type="text" className="form-control mono"
                style={{ maxWidth: 240 }}
                value={form.war_name || ''}
                onChange={e => set('war_name', e.target.value)}
                placeholder="CONVUAT"
              />
              <p className="form-hint">Filename without .war extension. WAR is uploaded to the App Root Path above.</p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tomcat Remote Path <span className="label-note">(optional — for startup/shutdown scripts)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.tomcat_remote_path || ''}
                onChange={e => set('tomcat_remote_path', e.target.value)}
                placeholder="/opt/tomcat  (uses bin/shutdown.sh + bin/startup.sh)"
              />
              <p className="form-hint">
                If set, "Restart Tomcat" runs <code>bin/shutdown.sh</code> then <code>bin/startup.sh</code>.
                If blank but Tomcat Service Name is set, uses <code>systemctl restart</code>.
              </p>
            </div>
          </div>
        )}

        {/* RDP-Assisted fields */}
        {form.deployment_mode === 'rdp_assisted' && (
          <>
            <div className="cred-card">
              <div className="cred-card-title">SERVER — WINDOWS (REMOTE DESKTOP)</div>
              <div className="form-grid-2" style={{ marginBottom: 14 }}>
                <CredField label="HOST"
                  value={form.server_host}
                  onChange={v => set('server_host', v)}
                  placeholder="10.10.2.130"
                  canCopy
                />
                <CredField label="PORT"
                  value={String(form.server_port || 3389)}
                  onChange={v => set('server_port', parseInt(v, 10) || 3389)}
                  placeholder="3389"
                  canCopy
                />
              </div>
              <div className="form-grid-2" style={{ marginBottom: 0 }}>
                <CredField label="USERNAME"
                  value={form.server_user}
                  onChange={v => set('server_user', v)}
                  placeholder="App.Admin"
                  canCopy
                />
                <CredField label="PASSWORD"
                  value={form.server_password}
                  onChange={v => set('server_password', v)}
                  type="password"
                  canCopy
                />
              </div>
              <p className="form-hint" style={{ marginTop: 8 }}>
                Credentials are shown as a copy-paste hint in the deploy dialog when Windows prompts for authentication.
                Patch Manager also runs <code>net use \\host</code> automatically before copying files.
              </p>
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
              <label>App Folder Path (Network Share)</label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.smb_path || ''}
                onChange={e => set('smb_path', e.target.value)}
                placeholder="\\10.10.2.130\APPLICATION\CONVUAT"
              />
              <p className="form-hint">UNC path to the app folder on the remote server.</p>
            </div>

            <div className="form-group">
              <label>Patch Path <span className="label-note">(optional)</span></label>
              <input
                type="text" className="form-control mono" style={{ fontSize: 12 }}
                value={form.patch_path || ''}
                onChange={e => set('patch_path', e.target.value)}
                placeholder="\\10.10.2.130\Patches_automated"
              />
              <p className="form-hint">
                Where fetched patches are saved for this app. Use a UNC path so patches land
                directly on the server share. Overrides the global patch root. Leave blank to use the global setting.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tomcat Service Name <span className="label-note">(optional)</span></label>
              <input
                type="text" className="form-control"
                style={{ maxWidth: 200 }}
                value={form.tomcat_service_name || ''}
                onChange={e => set('tomcat_service_name', e.target.value)}
                placeholder="Tomcat9"
              />
              <p className="form-hint">
                Windows service name used for <code>sc \\host stop/start</code>.
                For Tomcat 11 installed via the Windows installer the service name is usually <strong>Tomcat11</strong>.
                To confirm: run <code>sc query type= all state= all</code> on the server and look for the Tomcat entry.
              </p>
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
