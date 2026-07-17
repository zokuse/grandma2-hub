import React, { useState, useEffect, useRef } from 'react';
import './index.css';

declare const __APP_VERSION__: string;

const TOOLS = [
  { id: 'home', label: 'Home', url: '../../home-app/dist/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg> },
  { id: 'divider-1', isDivider: true },
  { id: 'cloner', label: 'Visual Cloner', url: '../../cloner/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> },
  { id: 'patch', label: 'Patch List', url: '../../patch/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> },
  { id: 'xyz', label: 'XYZ Injector', url: '../../xyz/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="16" x2="8" y2="4"></line><polyline points="5 7 8 4 11 7"></polyline><line x1="8" y1="16" x2="20" y2="16"></line><polyline points="17 13 20 16 17 19"></polyline><line x1="8" y1="16" x2="3" y2="21"></line><polyline points="3 17 3 21 7 21"></polyline></svg> },
  { id: 'gltf', label: 'glTF Unpacker', url: '../../gltf/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> },
  { id: 'dmx', label: 'DMX View', url: '../../dmx/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg> },
  { id: 'spacer-1', isSpacer: true },
  { id: 'settings', label: 'Settings', url: '../../settings-app/dist/index.html', icon: <svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg> }
];

// Helper to inject qt objects into iframes
const injectQtPolyfill = (iframe: HTMLIFrameElement) => {
  if (iframe && iframe.contentWindow) {
    if ((window as any).qt) {
      (iframe.contentWindow as any).qt = (window as any).qt;
      (iframe.contentWindow as any).QWebChannel = (window as any).QWebChannel;
    }
  }
};

function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [expanded, setExpanded] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set(['home']));
  const [updateReady, setUpdateReady] = useState<{ version: string } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Expose switchTab globally so child iframes can call window.parent.switchTab('...')
    (window as any).switchTab = (tabId: string) => {
      setActiveTab(tabId);
      setLoadedTabs(prev => new Set(prev).add(tabId));
    };

    // Listen for update-ready event from the auto-updater
    if ((window as any).electronUpdater) {
      (window as any).electronUpdater.onUpdateReady((info: { version: string }) => {
        setUpdateReady(info);
      });
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleSidebarClick = (e: React.MouseEvent) => {
    // If clicking background of sidebar (not a button), toggle expanded state
    if (!(e.target as HTMLElement).closest('.nav-btn')) {
      setExpanded(!expanded);
    }
  };

  return (
    <>
      <div 
        id="sidebar" 
        ref={sidebarRef}
        className={expanded ? 'expanded' : ''} 
        onClick={handleSidebarClick}
      >
        {TOOLS.map((tool) => {
          if (tool.isDivider) return <div key={tool.id} className="divider" />;
          if (tool.isSpacer) return <div key={tool.id} className="spacer" />;
          return (
            <button
              key={tool.id}
              className={`nav-btn ${activeTab === tool.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tool.id!);
                setLoadedTabs(prev => new Set(prev).add(tool.id!));
                setExpanded(false);
              }}
            >
              <div className="nav-icon">{tool.icon}</div>
              <span className="nav-label">{tool.label}</span>
            </button>
          );
        })}

        {/* Version Badge — always visible at bottom of sidebar */}
        <div className="version-badge">
          <span className="version-text">v{__APP_VERSION__}</span>
        </div>
      </div>

      {/* Update Banner — slides in when update is downloaded */}
      {updateReady && (
        <div className="update-banner" role="alert">
          <div className="update-banner__inner">
            <svg className="update-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span className="update-banner__text">
              GrandMA2 Hub <strong>v{updateReady.version}</strong> is ready to install.
            </span>
            <button
              id="btn-restart-update"
              className="update-banner__btn"
              onClick={() => (window as any).electronUpdater?.restartAndInstall()}
            >
              Restart &amp; Update
            </button>
            <button
              id="btn-dismiss-update"
              className="update-banner__dismiss"
              onClick={() => setUpdateReady(null)}
              aria-label="Dismiss update notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div id="content">
        {TOOLS.filter(t => !t.isDivider && !t.isSpacer).map((tool) => (
          loadedTabs.has(tool.id!) ? (
            <iframe
              key={tool.id}
              id={`frame-${tool.id}`}
              src={tool.url}
              title={tool.label}
              style={{ display: activeTab === tool.id ? 'block' : 'none' }}
              onLoad={(e) => injectQtPolyfill(e.currentTarget)}
            />
          ) : null
        ))}
      </div>
    </>
  );
}

export default App;
