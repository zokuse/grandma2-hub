const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const net = require('net');
const { app, safeStorage } = require('electron');

class MA2Client {
    _getUserDataDir() {
        const dir = app.getPath('userData');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    constructor() {
        const userData = this._getUserDataDir();
        this.configFile = path.join(userData, '.ma2_hub_config.json');
        this.fixtureSpecsFile = path.join(userData, '.ma2_fixture_specs.json');
        this._migrateFromHomedir();
        this.credentials = this.loadCredentials();
        this.baseDir = this.findMA2Dir();
        this.layoutDir = path.join(this.baseDir, 'importexport');
        this.patchDir = path.join(this.baseDir, 'fixture_layers');
        this.macroDir = path.join(this.baseDir, 'macros');
    }

    _migrateFromHomedir() {
        const oldConfigFile = path.join(os.homedir(), '.ma2_hub_config.json');
        const oldSpecsFile = path.join(os.homedir(), '.ma2_fixture_specs.json');

        if (fs.existsSync(oldConfigFile) && !fs.existsSync(this.configFile)) {
            try {
                fs.copyFileSync(oldConfigFile, this.configFile);
                fs.unlinkSync(oldConfigFile);
                console.log('[MA2Client] Migrated config to AppData.');
            } catch (e) {
                console.error('[MA2Client] Migration failed for config:', e.message);
            }
        }

        if (fs.existsSync(oldSpecsFile) && !fs.existsSync(this.fixtureSpecsFile)) {
            try {
                fs.copyFileSync(oldSpecsFile, this.fixtureSpecsFile);
                fs.unlinkSync(oldSpecsFile);
                console.log('[MA2Client] Migrated fixture specs to AppData.');
            } catch (e) {
                console.error('[MA2Client] Migration failed for fixture specs:', e.message);
            }
        }
    }

    findMA2Dir() {
        const programData = process.env.ProgramData || 'C:\\ProgramData';
        const ma2Root = path.join(programData, 'MA Lighting Technologies', 'grandma');
        try {
            if (fs.existsSync(ma2Root)) {
                const dirs = fs.readdirSync(ma2Root, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('gma2_V_'))
                    .map(dirent => dirent.name)
                    .sort();
                if (dirs.length > 0) {
                    return path.join(ma2Root, dirs[dirs.length - 1]);
                }
            }
        } catch (e) {
            console.error('Error finding MA2 directory:', e);
        }
        return path.join(ma2Root, 'gma2_V_3.9.60');
    }

    loadCredentials() {
        if (fs.existsSync(this.configFile)) {
            try {
                const encoded = fs.readFileSync(this.configFile, 'utf8');
                let decoded;
                if (safeStorage && safeStorage.isEncryptionAvailable()) {
                    try {
                        const buffer = Buffer.from(encoded, 'base64');
                        decoded = safeStorage.decryptString(buffer);
                    } catch (e) {
                        // fallback to base64 if it wasn't encrypted (migration)
                        decoded = Buffer.from(encoded, 'base64').toString('utf8');
                    }
                } else {
                    decoded = Buffer.from(encoded, 'base64').toString('utf8');
                }
                return JSON.parse(decoded);
            } catch (e) {}
        }
        return null;
    }

    saveCredentials(creds) {
        this.credentials = creds;
        try {
            const jsonStr = JSON.stringify(creds);
            let encoded;
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                encoded = safeStorage.encryptString(jsonStr).toString('base64');
            } else {
                encoded = Buffer.from(jsonStr, 'utf8').toString('base64');
            }
            fs.writeFileSync(this.configFile, encoded, 'utf8');
        } catch (e) {}
    }

    clearCredentials() {
        this.credentials = null;
        if (fs.existsSync(this.configFile)) {
            try { fs.unlinkSync(this.configFile); } catch (e) {}
        }
    }

    async getLocalIps() {
        return new Promise((resolve) => {
            exec('ipconfig /all', (error, stdout) => {
                if (error) {
                    return resolve(JSON.stringify(["2.0.0.1 - GrandMA2 Loopback", "127.0.0.1 - Localhost"]));
                }

                const adapters = [];
                const seenIps = new Set();
                let currentDesc = "";
                let isDisconnected = false;

                const lines = stdout.split('\n');
                for (let line of lines) {
                    const stripped = line.trim();
                    if (line && !line.match(/^\s/) && stripped.endsWith(':') && stripped !== ':') {
                        currentDesc = stripped.replace(/:$/, '').trim();
                        isDisconnected = false;
                        continue;
                    }

                    if (stripped.includes('Media disconnected') || (stripped.includes('Media State') && stripped.includes('Disconnected'))) {
                        isDisconnected = true;
                    }

                    if (stripped.startsWith('Description')) {
                        const parts = stripped.split(':');
                        if (parts.length > 1) currentDesc = parts.slice(1).join(':').trim();
                    } else if (stripped.startsWith('IPv4 Address') || stripped.startsWith('Autoconfiguration IPv4') || stripped.startsWith('IP Address')) {
                        const parts = stripped.split(':');
                        if (parts.length > 1) {
                            const ip = parts[1].split('(')[0].trim();
                            if (ip && !seenIps.has(ip)) {
                                seenIps.add(ip);
                                let label = `${ip} - ${currentDesc}`;
                                if (isDisconnected) label += ' (Disconnected)';
                                adapters.push(label);
                            }
                        }
                    }
                }

                if (!adapters.some(a => a.includes('2.0.0.1'))) {
                    adapters.unshift('2.0.0.1 - GrandMA2 Loopback');
                }
                if (!adapters.some(a => a.includes('127.0.0.1'))) {
                    adapters.push('127.0.0.1 - Localhost');
                }

                resolve(JSON.stringify(adapters));
            });
        });
    }

    async waitForFile(filePath, timeoutMs = 15000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (fs.existsSync(filePath)) {
                await new Promise(r => setTimeout(r, 500)); // give MA2 time to finish writing
                return true;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }

    // Connects to MA2 Telnet, logs in, and returns a connected socket wrapper
    async telnetSession(credentials, onProgress) {
        const creds = credentials || this.credentials;
        if (!creds || !creds.ip) throw new Error("No credentials provided");

        if (onProgress) onProgress("Connecting to MA2...");
        
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            let timeoutHandler = setTimeout(() => {
                socket.destroy();
                reject(new Error("Connection timed out - the host did not respond on port 30000. Check the IP address and ensure GrandMA2 is running."));
            }, 5000);

            socket.connect(30000, creds.ip, async () => {
                clearTimeout(timeoutHandler);
                
                // Helper to send command and wait for prompt
                socket.sendCommand = async (cmd, waitTimeoutMs = 5000) => {
                    return new Promise((res, rej) => {
                        let buffer = "";
                        let cmdTimeout = setTimeout(() => {
                            socket.removeListener('data', onData);
                            // If we got a partial response that has a prompt, resolve it;
                            // otherwise reject so the caller knows the command stalled.
                            if (buffer.includes('>')) {
                                res(buffer);
                            } else {
                                socket.destroy();
                                rej(new Error(`MA2 command timed out after ${waitTimeoutMs}ms: "${cmd}". Console may be busy or unresponsive.`));
                            }
                        }, waitTimeoutMs);

                        const onData = (data) => {
                            let str = data.toString('utf8');
                            // Strip ANSI escape codes
                            str = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
                            buffer += str;
                            if (buffer.includes('>')) {
                                clearTimeout(cmdTimeout);
                                socket.removeListener('data', onData);
                                res(buffer);
                            }
                        };
                        socket.on('data', onData);
                        socket.write(cmd + '\r\n');
                    });
                };

                try {
                    if (onProgress) onProgress("Logging in...");
                    // Wait for initial prompt/banner
                    await new Promise(r => setTimeout(r, 200)); 
                    const loginRes = await socket.sendCommand(`login "${creds.user}" "${creds.password}"`, 3000);
                    const promptRes = await socket.sendCommand('SelectDrive 1', 2000);
                    const combinedRes = (loginRes + promptRes).toLowerCase();
                    
                    if (!combinedRes.includes('>')) {
                        throw new Error("GrandMA2 is unresponsive. Ensure 'Patch & Fixture Schedule' or SETUP is closed, as they block remote commands.");
                    }
                    if (combinedRes.includes('[setup]') || combinedRes.includes('[patch]') || combinedRes.includes('[editsetup]')) {
                        throw new Error("GrandMA2 is currently in a Menu. Please close 'Patch & Fixture Schedule' to allow remote commands.");
                    }
                    resolve(socket);
                } catch (e) {
                    socket.destroy();
                    reject(e);
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timeoutHandler);
                let msg = err.message;
                if (err.code === 'ECONNREFUSED') {
                    msg = `Connection refused - GrandMA2 is not running or its Telnet console is disabled.`;
                } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
                    msg = `No route to host - the network adapter may be disconnected or the IP is on an unreachable subnet.`;
                }
                reject(new Error(msg));
            });
        });
    }
}

module.exports = MA2Client;
