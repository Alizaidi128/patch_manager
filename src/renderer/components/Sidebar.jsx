import { useState } from 'react'
import { InboxIcon, LogIcon, SettingsIcon, SunIcon, MoonIcon, PencilIcon, PlusIcon } from '../icons.jsx'

export default function Sidebar({ apps, selectedAppId, activeView, theme, onToggleTheme, onSelectApp, onEditApp, onAddApp, onNavigate }) {
  const [hoveredId, setHoveredId] = useState(null)

  const activeApps   = apps.filter(a => a.is_active)
  const inactiveApps = apps.filter(a => !a.is_active)

  function AppItem({ app }) {
    const isActive  = app.id === selectedAppId
    const isHovered = app.id === hoveredId

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
            <PencilIcon size={13} />
          </button>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Patch Manager</h1>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
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
          <button className="btn btn-secondary btn-sm" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={onAddApp}>
            <PlusIcon size={13} /> Add App
          </button>
        </div>
      </div>

      <nav className="sidebar-footer">
        <div
          className={`sidebar-nav-item${activeView === 'dashboard' ? ' active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <span className="nav-icon"><InboxIcon size={15} /></span>
          Dashboard
        </div>
        <div
          className={`sidebar-nav-item${activeView === 'logs' ? ' active' : ''}`}
          onClick={() => onNavigate('logs')}
        >
          <span className="nav-icon"><LogIcon size={15} /></span>
          Deploy Log
        </div>
        <div
          className={`sidebar-nav-item${activeView === 'settings' ? ' active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <span className="nav-icon"><SettingsIcon size={15} /></span>
          Settings
        </div>
      </nav>
    </aside>
  )
}
