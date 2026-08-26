import { useState, useEffect, useRef } from 'react'

export default function FolderPickerModal({ currentPath, onSelect, onClose }) {
  const [folders, setFolders]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState(currentPath || '')
  const searchRef = useRef(null)

  useEffect(() => {
    searchRef.current?.focus()
    loadFolders()
  }, [])

  async function loadFolders() {
    try {
      const running = await window.api.invoke('outlook:check-running')
      if (!running) {
        setError('Outlook is not running.\nPlease open Microsoft Outlook and try again.')
        setLoading(false)
        return
      }
      const data = await window.api.invoke('outlook:get-folders')
      setFolders(Array.isArray(data) ? data : (data ? [data] : []))
    } catch (e) {
      setError(e.message || 'Failed to load Outlook folders.')
    }
    setLoading(false)
  }

  const filtered = search.trim()
    ? folders.filter(f =>
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.path.toLowerCase().includes(search.toLowerCase())
      )
    : folders

  function handleConfirm() {
    const folder = folders.find(f => f.path === selected)
    if (!folder || folder.depth === 0) return
    onSelect(selected)
    onClose()
  }

  function handleKey(e) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') handleConfirm()
  }

  const canConfirm = selected && folders.find(f => f.path === selected)?.depth > 0

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKey}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <h3>Select Outlook Folder</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-search">
          <input
            ref={searchRef}
            type="text"
            className="form-control"
            placeholder="Search folders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="modal-body folder-list-wrap">
          {loading && (
            <div className="folder-loading">Loading folders from Outlook…</div>
          )}

          {!loading && error && (
            <div className="alert alert-error" style={{ margin: 16, whiteSpace: 'pre-line' }}>
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="folder-loading">No folders found</div>
          )}

          {!loading && !error && filtered.map((f, i) => {
            const isRoot     = f.depth === 0
            const isSelected = f.path === selected

            return (
              <div
                key={i}
                className={[
                  'folder-item',
                  isRoot ? 'folder-root' : '',
                  isSelected ? 'folder-selected' : ''
                ].filter(Boolean).join(' ')}
                style={{ paddingLeft: 12 + f.depth * 18 }}
                onClick={() => !isRoot && setSelected(f.path)}
                onDoubleClick={() => { if (!isRoot) { setSelected(f.path); handleConfirm() } }}
              >
                <span className="folder-icon">
                  {isRoot ? '🗄️' : f.count > 0 ? '📬' : '📁'}
                </span>
                <span className="folder-name">{f.name}</span>
                {f.count > 0 && <span className="folder-count">{f.count}</span>}
              </div>
            )
          })}
        </div>

        {selected && folders.find(f => f.path === selected)?.depth > 0 && (
          <div className="folder-selected-path">
            Selected: <code>{selected}</code>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={!canConfirm}>
            Use This Folder
          </button>
        </div>
      </div>
    </div>
  )
}
