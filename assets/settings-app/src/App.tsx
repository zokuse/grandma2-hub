import { useEffect, useState } from 'react';
import './index.css';

function App() {
  const [ip, setIp] = useState('');
  const [user, setUser] = useState('administrator');
  const [password, setPassword] = useState('admin');
  const [ipList, setIpList] = useState<string[]>([]);
  
  const [saveStatus, setSaveStatus] = useState('Save Credentials');
  const [clearStatus, setClearStatus] = useState('Clear Connection');

  useEffect(() => {
    let checkInterval: number;

    const initBridge = () => {
      if (typeof window.qt !== 'undefined' && window.qt.webChannelTransport) {
        new window.QWebChannel(window.qt.webChannelTransport, function(channel: any) {
          window.pyBridge = channel.objects.backend;
          
          if (window.pyBridge && window.pyBridge.get_saved_credentials) {
            window.pyBridge.get_saved_credentials((credsStr) => {
              if (credsStr) {
                try {
                  const creds = JSON.parse(credsStr);
                  if (creds.ip) setIp(creds.ip);
                  if (creds.user) setUser(creds.user);
                  if (creds.password) setPassword(creds.password);
                } catch(e) {
                  console.error("Failed to parse settings:", e);
                }
              }
            });
          }
          
          if (window.pyBridge && window.pyBridge.get_local_ips) {
            window.pyBridge.get_local_ips((ipsStr) => {
              try {
                const ips = JSON.parse(ipsStr);
                setIpList(ips);
              } catch(e) {}
            });
          }
        });
        clearInterval(checkInterval);
      }
    };

    checkInterval = window.setInterval(initBridge, 100);
    initBridge();

    return () => clearInterval(checkInterval);
  }, []);

  const handleSave = () => {
    if (!window.pyBridge) return;
    
    const finalIp = ip || "127.0.0.1";
    const finalUser = user || "administrator";
    const finalPass = password || "admin";
    
    const creds = {
      ip: finalIp.split(' ')[0].trim(), 
      user: finalUser.trim(),
      password: finalPass
    };
    
    setSaveStatus("Saving...");
    
    window.pyBridge.save_global_credentials(JSON.stringify(creds), (resStr) => {
      try {
        const res = JSON.parse(resStr);
        if (res.success) {
          setSaveStatus("Saved Successfully!");
          setTimeout(() => setSaveStatus("Save Credentials"), 2000);
        } else {
          setSaveStatus("Save Failed");
          console.error(res.error);
          setTimeout(() => setSaveStatus("Save Credentials"), 2000);
        }
      } catch(e) {
        setSaveStatus("Save Credentials");
      }
    });
  };

  const handleClear = () => {
    if (!window.pyBridge) return;
    
    setClearStatus("Clearing...");
    
    window.pyBridge.clear_credentials().then(() => {
      setIp("");
      setUser("");
      setPassword("");
      
      setClearStatus("Cleared!");
      setTimeout(() => setClearStatus("Clear Connection"), 2000);
    });
  };

  return (
    <div style={{ padding: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 80px)', position: 'relative' }}>
      <div className="settings-split-card">
        
        {/* LEFT PANEL */}
        <div className="settings-left-panel">
          <svg className="settings-illustration" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
          <div className="settings-version-tag">
            V {(window as any).appVersion || '1.0.0'}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="settings-right-panel">
          <h2 className="settings-title">Connection</h2>
          <p className="settings-subtitle">
            Configure your console credentials used for Telnet macro injection and patch pulling.
          </p>
          
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              IP Address
            </label>
            <div className="input-with-icon-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              <input 
                type="text" 
                className="form-control input-with-icon" 
                placeholder="Select or type IP..." 
                list="ip-list"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                onFocus={() => setIp('')}
              />
              <datalist id="ip-list">
                {ipList.map(item => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
          </div>
          
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Username
            </label>
            <div className="input-with-icon-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              <input 
                type="text" 
                className="form-control input-with-icon" 
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
          </div>
          
          <div className="form-group" style={{ marginBottom: '32px' }}>
            <label style={{ fontSize: '11px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Password
            </label>
            <div className="input-with-icon-wrapper">
              <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <input 
                type="password" 
                className="form-control input-with-icon" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn-glass-danger btn-icon btn-clear-animated" 
              style={{ padding: '0 20px', borderRadius: '8px', border: '1px solid rgba(255, 82, 82, 0.4)' }} 
              onClick={handleClear}
            >
              {clearStatus}
            </button>
            <button 
              className="btn-primary btn-save-animated" 
              style={{ borderRadius: '8px' }} 
              onClick={handleSave}
            >
              {saveStatus}
            </button>
          </div>

        </div>
      </div>
      
      <footer className="app-footer" style={{ position: 'absolute', bottom: '20px', width: '100%' }}>
        <p>&copy; 2026 zokuse. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
