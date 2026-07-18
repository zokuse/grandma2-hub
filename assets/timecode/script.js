import { parseReaperProject } from './src/lib/ReaperParser.js?v=2';
import { parseOffset, formatTimecodeString } from './src/lib/TimecodeMath.js?v=2';
import { generateMA2XML } from './src/lib/MA2Export.js?v=2';
import { buildFollowUpCommands } from './src/lib/MA2Commands.js?v=2';

window.browseFile = browseFile;
window.downloadXML = downloadXML;
window.triggerSendToMA2 = triggerSendToMA2;
window.closeModal = closeModal;
window.submitLogin = submitLogin;

let pyBridge = null;
let currentXML = null;
let currentFollowUpCommands = [];
let currentParsedData = null;

// ============================================================
// INIT BRIDGE
// ============================================================
let bridgeInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    let checkInterval;
    function initBridge() {
        if (bridgeInitialized) return;
        if (typeof qt !== 'undefined' && qt.webChannelTransport) {
            bridgeInitialized = true;
            new QWebChannel(qt.webChannelTransport, channel => {
                window.pyBridge = channel.objects.backend;
                pyBridge = window.pyBridge;
                
                if (pyBridge.progress_update) {
                    pyBridge.progress_update.connect(msg => {
                        const el = document.getElementById('loading-text');
                        if (el) el.textContent = msg;
                    });
                }
                
                if (pyBridge.macros_sent) {
                    pyBridge.macros_sent.connect(res_json => {
                        hideLoading();
                        try {
                            const res = JSON.parse(res_json);
                            if (!res.success) {
                                showToast(res.error || 'Send failed', 'error');
                                return;
                            }
                            showToast(res.message || 'Successfully sent to MA2!', 'success');
                        } catch (e) {
                            showToast('Error parsing send response', 'error');
                        }
                    });
                }
                
                if (pyBridge.get_local_ips) {
                    pyBridge.get_local_ips(res => {
                        try {
                            const ips = JSON.parse(res);
                            const dl = document.getElementById('ip-list');
                            if (!dl) return;
                            dl.innerHTML = '';
                            ips.forEach(ip => {
                                const opt = document.createElement('option');
                                opt.value = ip.split(' - ')[0];
                                opt.label = ip;
                                dl.appendChild(opt);
                            });
                        } catch (e) {}
                    });
                }

                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
            });
        } else if (window.parent && window.parent.pyBridge) {
            // Fallback just in case
            bridgeInitialized = true;
            pyBridge = window.parent.pyBridge;
            window.pyBridge = pyBridge;
            
            if (checkInterval) {
                clearInterval(checkInterval);
                checkInterval = null;
            }
        }
    }
    checkInterval = setInterval(initBridge, 100);
    initBridge();

    // Drag and Drop
    const dropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    // Auto-generate XML on settings change
    const inputs = ['export-mode', 'fps', 'tc-offset', 'start-seq', 'start-tc', 'tc-name', 'exec-page', 'exec-number'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', generateXMLFromState);
        document.getElementById(id).addEventListener('change', generateXMLFromState);
    });
    document.getElementById('enable-assign').addEventListener('change', generateXMLFromState);
});

// ============================================================
// FILE HANDLING
// ============================================================
function browseFile() {
    document.getElementById('file-input').click();
}

async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.rpp')) {
        showToast('Please select a REAPER Project (.rpp) file', 'error');
        return;
    }

    const dropZone = document.getElementById('file-drop-zone');
    dropZone.classList.add('loaded');

    const fileContent = await file.text();
    currentParsedData = parseReaperProject(fileContent);

    // Render Preview
    renderPreview();
    
    // Enable Buttons
    document.getElementById('btn-download-xml').disabled = false;
    document.getElementById('btn-send-to-ma2').disabled = false;
    
    // Hide empty state
    document.getElementById('empty-state').style.display = 'none';

    generateXMLFromState();
}

function renderPreview() {
    const container = document.getElementById('preview-container');
    container.innerHTML = '';
    
    document.getElementById('file-drop-zone').style.display = 'none';
    document.getElementById('table-view').style.display = 'flex';

    if (!currentParsedData || currentParsedData.mainMarkers.length === 0) return;

    const fps = parseInt(document.getElementById('fps').value, 10);
    const offsetInput = document.getElementById('tc-offset').value;
    const customOffset = offsetInput !== '00:00:00.00' ? parseOffset(offsetInput, fps) : null;
    const offsetTime = (customOffset !== null && customOffset !== undefined) ? customOffset : currentParsedData.offset;

    const markers = currentParsedData.mainMarkers;

    markers.forEach((marker, index) => {
        const nextMarker = markers[index + 1];
        let lengthDisplay = 0;
        if (nextMarker) {
            lengthDisplay = Number((nextMarker.time - marker.time).toFixed(2));
        }
        const tcStr = formatTimecodeString(marker.time + offsetTime, fps);
        const markerName = marker.name || "";
        const isMain = markerName !== "" ? `<div class="dot"></div>` : "";
        container.innerHTML += `
            <div class="mapping-row">
                <div class="tc-cue">${index + 1}</div>
                <div class="tc-timecode">${tcStr.replace('.', ':')}</div>
                <div class="tc-name-group">
                    ${isMain}
                    <div class="tc-name" title="${markerName}">${markerName}</div>
                </div>
                <div class="tc-length">${lengthDisplay}s</div>
            </div>`;
    });
}

function generateXMLFromState() {
    if (!currentParsedData) return;

    const exportMode = document.getElementById('export-mode').value;
    const fps = parseInt(document.getElementById('fps').value, 10);
    const offsetInput = document.getElementById('tc-offset').value;
    const customOffset = offsetInput !== '00:00:00.00' ? parseOffset(offsetInput, fps) : null;
    
    const startSequenceIndex = parseInt(document.getElementById('start-seq').value, 10);
    const startTimecodeIndex = parseInt(document.getElementById('start-tc').value, 10);
    const tcName = document.getElementById('tc-name').value;

    const enableAssign = document.getElementById('enable-assign').checked;
    const executor = enableAssign ? {
        page: parseInt(document.getElementById('exec-page').value, 10) || 1,
        number: parseInt(document.getElementById('exec-number').value, 10) || 1
    } : null;

    currentXML = generateMA2XML(currentParsedData, exportMode, fps, customOffset, {
        startSequenceIndex,
        startTimecodeIndex,
        tcName,
        executor
    });

    currentFollowUpCommands = buildFollowUpCommands(startSequenceIndex, {
        label: tcName,
        executor,
        timecodeIndex: startTimecodeIndex,
        exportMode: exportMode,
        parsedData: currentParsedData
    });
}

// ============================================================
// EXPORT & SEND
// ============================================================
function downloadXML() {
    if (!currentXML) return;
    const a = document.createElement('a');
    a.href = 'data:text/xml;charset=utf-8,' + encodeURIComponent(currentXML);
    a.download = 'MA2_Timecode.xml';
    a.click();
    showToast('XML Downloaded!', 'success');
}

function triggerSendToMA2() {
    if (!currentXML) return;
    if (!pyBridge) { showToast('Bridge not ready', 'error'); return; }
    
    if (pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            if (credsStr) {
                try {
                    const creds = JSON.parse(credsStr);
                    if (creds.ip && creds.ip.trim() !== '') {
                        doSend(credsStr);
                        return;
                    }
                } catch(e) {}
            }
            openModal('login-modal');
        });
    } else {
        openModal('login-modal');
    }
}

function submitLogin() {
    closeModal('login-modal');
    const creds = {
        ip:       (document.getElementById('login-ip').value || '').split(' ')[0] || '127.0.0.1',
        user:     document.getElementById('login-user').value || 'administrator',
        password: document.getElementById('login-pass').value || 'admin',
    };
    if (!creds.ip) { showToast('Enter the MA2 IP address', 'error'); return; }
    doSend(JSON.stringify(creds));
}

function doSend(credsStr) {
    showLoading('Connecting to MA2...');
    
    const exportMode = document.getElementById('export-mode').value;
    const startSequenceIndex = parseInt(document.getElementById('start-seq').value, 10);
    const startTimecodeIndex = parseInt(document.getElementById('start-tc').value, 10);
    const enableAssign = document.getElementById('enable-assign').checked;
    
    // We send currentXML, creds, and instructions on what to import via Telnet
    if (pyBridge.send_timecode_to_ma2) {
        pyBridge.send_timecode_to_ma2(credsStr, currentXML, JSON.stringify({
            startSequenceIndex,
            startTimecodeIndex,
            exportMode,
            followUpCommands: currentFollowUpCommands,
            executor: enableAssign ? { page: parseInt(document.getElementById('exec-page').value, 10) || 1, number: parseInt(document.getElementById('exec-number').value, 10) || 1 } : null
        })).then(resStr => { hideLoading(); showToast('Success', 'success'); }).catch(err => { hideLoading(); showToast('Error: ' + err, 'error'); });
    } else {
        hideLoading();
        showToast('Backend update required for this feature.', 'error');
    }
}

// ============================================================
// UI HELPERS (Standard)
// ============================================================
// (Playback functions removed to simplify app to pure extractor)

// Helpers have been removed or simplified.

function showLoading(text = 'Communicating...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const escapedMessage = String(message)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    toast.innerHTML = `<span>${icons[type] || '●'}</span><span style="margin-left: 6px;">${escapedMessage}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}
