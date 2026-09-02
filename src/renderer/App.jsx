import { useState, useEffect, useCallback } from 'react'
import UpdateBanner from './components/UpdateBanner'
import Sidebar from './components/Sidebar'
import Settings from './components/Settings'
import AppConfig from './components/AppConfig'
import PatchInbox from './components/PatchInbox'
import FetchDialog from './components/FetchDialog'
import ManualPathDialog from './components/ManualPathDialog'
import MergePreviewDialog from './components/MergePreviewDialog'
import DeployDialog from './components/DeployDialog'
import DeployLog from './components/DeployLog'

function PlaceholderView({ icon, title, hint }) {
  return (
    <div className="placeholder-screen">
      <div className="placeholder-icon">{icon}</div>
      <p>{title}</p>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export default function App() {
  const [view, setView]               = useState('dashboard')
  const [apps, setApps]               = useState([])
  const [appsLoaded, setAppsLoaded]   = useState(false)

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])
  const [selectedAppId, setSelectedAppId] = useState(null)
  const [editAppId, setEditAppId]     = useState(null)

  // Dialogs
  const [showFetch, setShowFetch]         = useState(false)
  const [missingPaths, setMissingPaths]   = useState([])
  const [mergeTarget, setMergeTarget]     = useState(null)
  const [deployPatchId, setDeployPatchId] = useState(null)

  // Background fetch state — shown as an inline panel in PatchInbox
  const [fetchState, setFetchState] = useState(null) // null | { running, result, error }

  // Inbox refresh counter
  const [inboxKey, setInboxKey] = useState(0)
  const refreshInbox = () => setInboxKey(k => k + 1)

  useEffect(() => { loadApps() }, [])

  function loadApps() {
    window.api.invoke('app:list')
      .then(list => { setApps(list || []); setAppsLoaded(true) })
      .catch(() => setAppsLoaded(true))
  }

  function handleSelectApp(id) {
    setSelectedAppId(id)
    setView('dashboard')
    setEditAppId(null)
  }

  function handleNavigate(v) {
    setView(v)
    if (v !== 'dashboard') setSelectedAppId(null)
    setEditAppId(null)
  }

  function handleAddApp() { setEditAppId(null); setView('app-config') }
  function handleEditApp(id) { setEditAppId(id); setView('app-config') }

  function handleAppSaved(savedApp) {
    loadApps(); setSelectedAppId(savedApp.id); setView('dashboard'); setEditAppId(null)
  }

  function handleAppDeleted() {
    loadApps(); setSelectedAppId(null); setView('dashboard'); setEditAppId(null)
  }

  function handleConfigCancel() { setEditAppId(null); setView('dashboard') }

  async function startFetch(config) {
    setShowFetch(false)
    setFetchState({ running: true, result: null, error: null, appIds: config.appIds })
    try {
      const res = await window.api.invoke('outlook:fetch', {
        appIds: config.appIds, sinceDate: config.since, toDate: config.toDate
      })
      setFetchState({ running: false, result: res, error: null, appIds: config.appIds })
      refreshInbox()
      if (res?.missingPaths?.length) setMissingPaths(res.missingPaths)
    } catch (e) {
      setFetchState({ running: false, result: null, error: e.message, appIds: config.appIds })
    }
  }

  const selectedApp = apps.find(a => a.id === selectedAppId)
  const editApp     = editAppId != null ? apps.find(a => a.id === editAppId) : null

  function renderContent() {
    switch (view) {

      case 'settings':
        return (
          <>
            <div className="content-header"><h2>Settings</h2></div>
            <div className="content-body"><Settings /></div>
          </>
        )

      case 'logs':
        return (
          <>
            <div className="content-header">
              <h2>Deployment Log</h2>
            </div>
            <div className="content-body" style={{ padding: 0 }}>
              <DeployLog apps={apps} />
            </div>
          </>
        )

      case 'app-config':
        return (
          <>
            <div className="content-header">
              <h2>{editAppId == null ? 'Add App' : 'Edit App'}</h2>
            </div>
            <div className="content-body">
              <AppConfig
                app={editApp || null}
                onSaved={handleAppSaved}
                onDeleted={handleAppDeleted}
                onCancel={handleConfigCancel}
              />
            </div>
          </>
        )

      default: // dashboard
        if (!selectedAppId) {
          return (
            <>
              <div className="content-header"><h2>Patch Manager</h2></div>
              <div className="content-body">
                {appsLoaded && apps.length === 0
                  ? <PlaceholderView icon="📬" title="No apps configured yet"
                      hint='Click "+ Add App" in the sidebar to get started' />
                  : <PlaceholderView icon="📬" title="Select an app from the sidebar"
                      hint="Then click Fetch to pull patches from Outlook" />
                }
              </div>
            </>
          )
        }
        return (
          <>
            <div className="content-header">
              <h2>{selectedApp?.name} — Patch Inbox</h2>
              <div className="content-header-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => handleEditApp(selectedAppId)}>
                  ⚙️ Edit App
                </button>
              </div>
            </div>
            <div className="content-body" style={{ padding: 0, overflow: 'hidden' }}>
              <PatchInbox
                app={selectedApp}
                onFetch={() => setShowFetch(true)}
                onMerge={target => setMergeTarget(target)}
                onDeploy={patchId => setDeployPatchId(patchId)}
                refreshKey={inboxKey}
                fetchState={fetchState}
                onClearFetch={() => setFetchState(null)}
              />
            </div>
          </>
        )
    }
  }

  return (
    <div className="app-layout">
      <UpdateBanner />
      <Sidebar
        apps={apps}
        selectedAppId={selectedAppId}
        activeView={view}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectApp={handleSelectApp}
        onEditApp={handleEditApp}
        onAddApp={handleAddApp}
        onNavigate={handleNavigate}
      />
      <main className="main-content">
        {renderContent()}
      </main>

      {showFetch && (
        <FetchDialog
          apps={apps}
          onClose={() => setShowFetch(false)}
          onStart={startFetch}
        />
      )}

      {missingPaths.length > 0 && (
        <ManualPathDialog
          items={missingPaths}
          onClose={() => setMissingPaths([])}
          onComplete={() => { setMissingPaths([]); refreshInbox() }}
        />
      )}

      {mergeTarget && (
        <MergePreviewDialog
          patchFileId={mergeTarget.patchFileId}
          onClose={() => setMergeTarget(null)}
          onApplied={() => { setMergeTarget(null); refreshInbox() }}
        />
      )}

      {deployPatchId && (
        <DeployDialog
          patchId={deployPatchId}
          onClose={() => setDeployPatchId(null)}
          onDeployed={() => { setDeployPatchId(null); refreshInbox() }}
        />
      )}
    </div>
  )
}
