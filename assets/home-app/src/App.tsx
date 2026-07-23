import { useEffect } from 'react';
import './index.css';

function App() {
  useEffect(() => {
    let checkInterval: number;
    const initBridge = () => {
      if (typeof window.qt !== 'undefined' && window.qt.webChannelTransport) {
        new window.QWebChannel(window.qt.webChannelTransport, function(channel: any) {
          window.pyBridge = channel.objects.backend;
        });
        clearInterval(checkInterval);
      }
    };
    checkInterval = window.setInterval(initBridge, 100);
    initBridge();
    return () => clearInterval(checkInterval);
  }, []);

  const switchTab = (tab: string) => {
    if (window.parent && (window.parent as any).switchTab) {
      (window.parent as any).switchTab(tab);
    }
    if ((window as any).pyBridge && (window as any).pyBridge.switch_to) {
      (window as any).pyBridge.switch_to(tab);
    }
  };

  return (
    <div className="workspace-container">
      <header className="app-header">
        <div className="header-title">
          <h1>MA2 <span>Hub</span></h1>
        </div>
        <p className="subtitle">The ultimate companion toolkit for advanced show programming and 3D visualization.</p>
      </header>

      <main className="grid-container">
        <div className="card" onClick={() => switchTab('cloner')}>
          <div className="card-icon" style={{ color: '#64b5f6' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </div>
          <div className="card-content">
            <h2>Visual Cloner</h2>
            <p>Visually clone fixtures directly from your GrandMA2 layouts. Instantly map clone sources and destinations using an intuitive interface.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('patch')}>
          <div className="card-icon" style={{ color: '#81c784' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
          </div>
          <div className="card-content">
            <h2>Patch List</h2>
            <p>Pull the active patch list live from the console. Instantly search, filter, and inspect fixture configurations and addresses.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('xyz')}>
          <div className="card-icon" style={{ color: '#ffb74d' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="16" x2="8" y2="4"></line><polyline points="5 7 8 4 11 7"></polyline><line x1="8" y1="16" x2="20" y2="16"></line><polyline points="17 13 20 16 17 19"></polyline><line x1="8" y1="16" x2="3" y2="21"></line><polyline points="3 17 3 21 7 21"></polyline></svg>
          </div>
          <div className="card-content">
            <h2>XYZ Injector</h2>
            <p>Map real-world 3D spatial coordinates from pre-viz software like Capture directly into your GrandMA2 fixture patch via telnet macros.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('gltf')}>
          <div className="card-icon" style={{ color: '#ba68c8' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          </div>
          <div className="card-content">
            <h2>glTF Unpacker</h2>
            <p>Extract metrics, wireframes, and raw textures from complex 3D stage models (.glb/.gltf) using a blazing fast WebGL engine.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('dmx')}>
          <div className="card-icon" style={{ color: '#e57373' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          </div>
          <div className="card-content">
            <h2>DMX View</h2>
            <p>Monitor live DMX outputs and universes directly from the console in real-time, helping you debug complex patching issues.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('timecode')}>
          <div className="card-icon" style={{ color: '#4dd0e1' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div className="card-content">
            <h2>Timecode Creator</h2>
            <p>Generate GrandMA2 XML timecode shows directly from REAPER .rpp project files with auto-assigned sequences and cues.</p>
          </div>
        </div>

        <div className="card" onClick={() => switchTab('artnet')}>
          <div className="card-icon" style={{ color: '#ffeb3b' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </div>
          <div className="card-content">
            <h2>Art-Net Viewer</h2>
            <p>Monitor live Art-Net traffic on the network with a high-framerate channel heatmap and node discovery.</p>
          </div>
        </div>

      </main>
      
      <footer className="app-footer">
        <p>&copy; 2026 zokuse. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
