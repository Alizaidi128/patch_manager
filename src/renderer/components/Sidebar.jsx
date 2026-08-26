import { useState } from 'react'

export default function Sidebar({ apps, selectedAppId, activeView, onSelectApp, onEditApp, onAddApp, onNavigate }) {
  const [hoveredId, setHoveredId] = useState(null)

  const activeApps   = apps.filter(a => a.is_active)
  const inactiveApps = apps.filter(a => !a.is_active)

  function AppItem({ app }) {
    const isActive   = app.id === selectedAppId
    const isHovered  = app.id === hoveredId

    return (
      <div
        className={`app-item${isActive ? ' active' : ''}`}
        onClick={() => onSelectApp(app.id)}
        onMouseEnter={() => setHoveredId(app.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <div className="app-dot dot-active" />
        <span className="app-name">{app.name}</span>
        {isHovered && (
          <button
            className="app-edit-btn"
            title="Edit app"
            onClick={e => { e.stopPropagation(); onEditApp(app.id) }}
          >
            ✏️
          </button>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Patch Manager</h1>
      </div>

      <div className="app-list">
        {activeApps.map(a => <AppItem key={a.id} app={a} />)}

        {inactiveApps.length > 0 && (
          <>
            <div className="app-section-label">Inactive</div>
            {inactiveApps.map(a => (
              <div key={a.id} className="app-item inactive">
                <div className="app-dot dot-inactive" />
                <span className="app-name">{a.name}</span>
              </div>
            ))}
          </>
        )}

        {activeApps.length === 0 && inactiveApps.length === 0 && (
          <div className="sidebar-empty">
            No apps yet.<br />Click + Add App to begin.
          </div>
        )}

        <div className="add-app-row">
          <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={onAddApp}>
            + Add App
          </button>
        </div>
      </div>

      <nav className="sidebar-footer">
        <div
          className={`sidebar-nav-item${activeView === 'dashboard' ? ' active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <span className="nav-icon">📬</span> Dashboard
        </div>
        <div
          className={`sidebar-nav-item${activeView === 'logs' ? ' active' : ''}`}
          onClick={() => onNavigate('logs')}
        >
          <span className="nav-icon">📋</span> Deploy Log
        </div>
        <div
          className={`sidebar-nav-item${activeView === 'settings' ? ' active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="nav-icon">⚙️</span> Settings
        </div>
      </nav>
    </aside>
  )
}
