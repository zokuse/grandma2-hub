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
    <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div className="glassy-surface" style={{ padding: '35px', boxSizing: 'border-box' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: 'white', marginTop: 0, marginBottom: '5px' }}>
            Console Connection
          </h2>
          <p style={{ fontSize: '13px', color: '#a0a0a0', marginTop: 0, marginBottom: '25px' }}>
            Credentials used for Telnet macro injection and patch pulling.
          </p>
          
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '12px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              IP Address
            </label>
            <input 
              type="text" 
              className="form-control" 
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
          
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '12px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Username
            </label>
            <input 
              type="text" 
              className="form-control" 
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </div>
          
          <div className="form-group" style={{ marginBottom: '25px' }}>
            <label style={{ fontSize: '12px', color: '#a0a0a0', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Password
            </label>
            <input 
              type="password" 
              className="form-control" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button 
              className="btn-glass-danger btn-icon" 
              style={{ padding: '12px 24px', fontSize: '14px', fontWeight: 'bold', borderRadius: '8px', border: '1px solid rgba(255, 82, 82, 0.4)' }} 
              onClick={handleClear}
            >
              {clearStatus}
            </button>
            <button 
              className="btn-primary" 
              style={{ padding: '12px 24px', fontSize: '14px', fontWeight: 'bold' }} 
              onClick={handleSave}
            >
              {saveStatus}
            </button>
          </div>
        </div>
        
        <footer className="app-footer">
          <p>&copy; 2026 zokuse. All rights reserved.</p>
        </footer>

      </div>
    </div>
  );
}

export default App;
