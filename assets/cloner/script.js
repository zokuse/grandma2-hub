let fixtures = []; let activeFixtureIds = []; let copiedMemoryFids = []; let nextFid = 1; let macroPool = []; 
let panX = 0; let panY = 0; let currentZoom = 1; const MIN_ZOOM = 0.1; const MAX_ZOOM = 3.0; 
let stateHistory = []; let historyIndex = -1; let isUndoing = false;

let pyBridge = null;

document.addEventListener("DOMContentLoaded", function() {
let checkInterval;
function initBridge() {
    if (typeof qt !== 'undefined' && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            window.pyBridge = channel.objects.backend;
            pyBridge = window.pyBridge;
            if (pyBridge.progress_update) {
                pyBridge.progress_update.connect(updateLoadingOverlay);
            }
            if (pyBridge.layout_pulled) {
                pyBridge.layout_pulled.connect(function(resStr) {
                    hideLoadingOverlay();
                    try {
                        let response = JSON.parse(resStr);
                        if (!response.success) { if (response.error !== "Cancelled") showToast("Error: " + response.error, "error"); return; }
                        if (response.showName) {
                            let fnInput = document.getElementById('export-filename');
                            if (fnInput) fnInput.value = response.showName;
                        }
                        if (parseLayoutXML(response.data)) {
                              updateLoadingOverlay("Connecting to MA2 for Patch...");
                              pyBridge.pull_patch(window._tempLoginStr);
                        }
                    } catch(e) { showToast("Error parsing layout response", "error"); }
                });
            }
            if (pyBridge.patch_pulled) {
                pyBridge.patch_pulled.connect(function(resStr) {
                    hideLoadingOverlay();
                    try {
                        let patchResponse = JSON.parse(resStr);
                        if (patchResponse.success) {
                            let matches = parsePatchXML(patchResponse.data);
                            showToast(`Layout pulled and ${matches} fixtures labeled!`, "success");
                        } else {
                            if (patchResponse.error !== "Cancelled") showToast("Patch Error: " + patchResponse.error, "error");
                        }
                        finishImport();
                    } catch(e) { showToast("Error parsing patch response", "error"); finishImport(); }
                });
            }
            if (pyBridge.macros_sent) {
                pyBridge.macros_sent.connect(function(resStr) {
                    hideLoadingOverlay();
                    try {
                        let response = JSON.parse(resStr);
                        if(response.success) showToast(response.message, "success");
                        else if (response.error !== "Cancelled") showToast(response.error, "error");
                    } catch(e) { showToast("Error parsing macro response", "error"); }
                });
            }
            if (pyBridge.get_local_ips) {
                pyBridge.get_local_ips(function(res) {
                    try {
                        let ips = JSON.parse(res);
                        let list = document.getElementById('ip-list');
                        if (list) {
                            ips.forEach(ip => {
                                let opt = document.createElement('option');
                                opt.value = ip;
                                list.appendChild(opt);
                            });
                        }
                    } catch(e) {}
                });
            }
        });
        clearInterval(checkInterval);
    }
}
checkInterval = setInterval(initBridge, 100);
initBridge();
    

});

const viewport = document.getElementById('workspace-viewport'); const workspaceCanvas = document.getElementById('workspace-canvas');
const selectionBox = document.getElementById('selection-box'); const zoomDisplay = document.getElementById('zoom-display');
const fixtureList = document.getElementById('fixture-list'); const fixtureCountDisplay = document.getElementById('fixture-count');
const inspectorTitle = document.getElementById('inspector-title'); const btnMainAction = document.getElementById('btn-main-action');
const memPanel = document.getElementById('memory-panel'); const inpId = document.getElementById('f-id');
const inpType = document.getElementById('f-type'); const inpSrc = document.getElementById('f-src');
const btnMemPaste = document.getElementById('btn-mem-paste'); const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo'); const fixturesPanel = document.getElementById('fixtures-panel');
const panelIcon = document.getElementById('panel-icon'); let isPanelMinimized = true;
const poolPanel = document.getElementById('pool-panel'); const poolPanelIcon = document.getElementById('pool-panel-icon'); let isPoolPanelMinimized = true;

function generateUUID() { return Date.now().toString() + Math.random().toString(36).substring(2); }

function escXML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container'); if (!container) return;
    const toast = document.createElement('div'); toast.className = `toast ${type}`;
    let icon = '';
    if (type === 'success') icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    else if (type === 'error') icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    else icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    
    let escapedMessage = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    toast.innerHTML = `${icon} <span style="margin-left: 6px;">${escapedMessage}</span>`; 
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 400); }, 3000);
}

function importMA2LayoutNative() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    pyBridge.import_layout(function(resStr) {
        let response = JSON.parse(resStr);
        if (!response.success) { if (response.error !== "Cancelled") showToast("Error: " + response.error, "error"); return; }
        if (response.showName) {
            let fnInput = document.getElementById('export-filename');
            if (fnInput) fnInput.value = response.showName;
        }
        if (parseLayoutXML(response.data)) finishImport();
    });
}

function importPatchXMLNative() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    pyBridge.import_patch(function(resStr) {
        let response = JSON.parse(resStr);
        if (!response.success) { if (response.error !== "Cancelled") showToast("Error: " + response.error, "error"); return; }
        if (response.showName) {
            let fnInput = document.getElementById('export-filename');
            if (fnInput && (fnInput.value === "MA2_CLONE_MACROS" || fnInput.value.trim() === "")) {
                fnInput.value = response.showName;
            }
        }
        if (parsePatchXML(response.data) > 0) {
            saveState(); render(); updateInspectorForm(); showToast("Auto-Labeled fixtures from Patch!", "success");
        }
    });
}

function pullFromGrandMA2() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    openModal('layout-modal');
}

function submitLayoutPull() {
    closeModal('layout-modal');
    window._pendingAction = 'layout';
    if (pyBridge && pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            if (credsStr) {
                try {
                    const creds = JSON.parse(credsStr);
                    if (creds.ip && creds.ip.trim() !== '') {
                        window._tempLoginStr = credsStr;
                        let layoutId = document.getElementById('layout-target-id').value || "1";
                        updateLoadingOverlay("Connecting to MA2...");
                        pyBridge.pull_layout(credsStr, layoutId);
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
    let creds = {
        ip: document.getElementById('login-ip').value.split(' ')[0] || "127.0.0.1",
        user: document.getElementById('login-user').value || "administrator",
        password: document.getElementById('login-pass').value || "admin"
    };
    let loginStr = JSON.stringify(creds);
    window._tempLoginStr = loginStr;
    
    if (window._pendingAction === 'layout') {
        let layoutId = document.getElementById('layout-target-id').value || "1";
        updateLoadingOverlay("Connecting to MA2...");
        pyBridge.pull_layout(loginStr, layoutId);
    } else if (window._pendingAction === 'macro') {
        let baseId = document.getElementById('macro-target-id').value;
        if (baseId && isNaN(parseInt(baseId))) {
            return showToast("Please enter a valid numeric ID", "error");
        }
        updateLoadingOverlay("Connecting to MA2...");
        pyBridge.send_to_console(JSON.stringify(macroPool), loginStr, baseId);
    }
}

function parseLayoutXML(xmlString) {
    try {
        const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const layoutFixtures = xmlDoc.querySelectorAll('LayoutSubFix'); let importedCount = 0; const MA_SCALE = 80;
        layoutFixtures.forEach(lf => {
            const cx = parseFloat(lf.getAttribute('center_x')) || 0; const cy = parseFloat(lf.getAttribute('center_y')) || 0;
            const subFixNode = lf.querySelector('Subfixture'); if (!subFixNode) return;
            const fId = subFixNode.getAttribute('fix_id'); if (!fId) return;
            const numFid = parseInt(fId); if (isNaN(numFid)) return;
            let snappedX = Math.round((cx * MA_SCALE) / 20) * 20; let snappedY = Math.round((cy * MA_SCALE) / 20) * 20;
            fixtures.push({ uid: generateUUID(), x: snappedX, y: snappedY, fid: fId, type: "", srcFid: "" });
            if (numFid >= nextFid) nextFid = numFid + 1;
            importedCount++;
        });
        if (importedCount === 0) showToast("No fixtures found in Layout XML", "error");
        return importedCount > 0;
    } catch (err) { showToast("XML Parse Error", "error"); return false; }
}

function parsePatchXML(xmlString) {
    try {
        const parser = new DOMParser(); const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const nodes = xmlDoc.querySelectorAll('Fixture[fixture_id]'); let matchCount = 0;
        nodes.forEach(n => {
            let fid = n.getAttribute('fixture_id'); let name = n.getAttribute('name');
            if (name && /^\d+\s+(.*)/.test(name)) name = name.match(/^\d+\s+(.*)/)[1];
            if (fid && name) { let f = fixtures.find(fx => fx.fid === fid); if (f) { f.type = name; matchCount++; } }
        });
        return matchCount;
    } catch(err) { showToast("Patch XML Parse Error", "error"); return 0; }
}

function finishImport() {
    saveState(); 
    render(); 
    setTimeout(() => zoomToFit(), 100); 
}

function exportMacroXML() {
    let exportFilename = document.getElementById('export-filename').value.trim();
    let safeName = exportFilename.replace(/[^a-zA-Z0-9_\- ]/g, '') || "MA2_CLONE_MACROS";
    if (macroPool.length === 0) {
        let validLinks = fixtures.filter(f => f.fid && f.srcFid);
        if (validLinks.length > 0) addCurrentToMacroPool(); else return showToast("No macros to export!", "error");
    }
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<MA xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" major_vers="3" minor_vers="9" stream_vers="60">\n`;
    macroPool.forEach(m => {
        xml += `\t<Macro index="${m.index}" name="${escXML(m.name)}">\n`;
        m.lines.forEach((line, i) => { xml += `\t\t<Macroline index="${i}"><text>${escXML(line)}</text></Macroline>\n`; });
        xml += `\t\t<Macroline index="${m.lines.length}" />\n\t</Macro>\n`;
    });
    xml += `</MA>`;
    if(pyBridge) {
        pyBridge.export_macros(xml, safeName, function(resStr) {
            let response = JSON.parse(resStr);
            if(response.success) showToast("Exported to: " + response.path, "success");
            else showToast("Export Failed: " + response.error, "error");
        });
    }
}



function sendToConsole() {
    if (macroPool.length === 0) {
        let validLinks = fixtures.filter(f => f.fid && f.srcFid);
        if (validLinks.length > 0) addCurrentToMacroPool(); else return showToast("No macros to send!", "error");
    }
    if(!pyBridge) return showToast("Bridge not ready", "error");
    openModal('macro-modal');
}

function submitMacroSend() {
    closeModal('macro-modal');
    window._pendingAction = 'macro';
    if (pyBridge && pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            if (credsStr) {
                try {
                    const creds = JSON.parse(credsStr);
                    if (creds.ip && creds.ip.trim() !== '') {
                        let baseId = document.getElementById('macro-target-id').value;
                        if (baseId && isNaN(parseInt(baseId))) {
                            return showToast("Please enter a valid numeric ID", "error");
                        }
                        updateLoadingOverlay("Connecting to MA2...");
                        pyBridge.send_to_console(JSON.stringify(macroPool), credsStr, baseId);
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

function deleteFixture(uid, event) { if(event) event.stopPropagation(); fixtures = fixtures.filter(f => f.uid !== uid); activeFixtureIds = activeFixtureIds.filter(id => id !== uid); selectFixtures(activeFixtureIds); handleSearch(); render(); saveState(); showToast("Fixture deleted", "info"); }
function toggleHelp() { const m = document.getElementById('help-modal'); m.classList.contains('active') ? m.classList.remove('active') : m.classList.add('active'); }
document.getElementById('help-modal').addEventListener('pointerdown', (e) => { if(e.target.id === 'help-modal') toggleHelp(); });

function toggleFixturesPanel(forceState) {
    if (forceState === 'close') isPanelMinimized = true; else if (forceState === 'open') isPanelMinimized = false; else isPanelMinimized = !isPanelMinimized;
    if (isPanelMinimized) { fixturesPanel.classList.add('minimized'); panelIcon.innerHTML = '<polyline points="15 18 9 12 15 6"></polyline>'; } else { fixturesPanel.classList.remove('minimized'); panelIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>'; }
}

function togglePoolPanel(forceState) {
    if (forceState === 'close') isPoolPanelMinimized = true; else if (forceState === 'open') isPoolPanelMinimized = false; else isPoolPanelMinimized = !isPoolPanelMinimized;
    const btnText = document.getElementById('pool-btn-text'); const btnIcon = document.getElementById('pool-btn-icon');
    if (isPoolPanelMinimized) {
        poolPanel.classList.add('minimized'); poolPanelIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>'; 
        if (btnText) { btnText.textContent = 'View Pool List'; btnIcon.innerHTML = '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>'; }
    } else {
        poolPanel.classList.remove('minimized'); poolPanelIcon.innerHTML = '<polyline points="15 18 9 12 15 6"></polyline>'; 
        if (btnText) { btnText.textContent = 'Hide Pool List'; btnIcon.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'; }
    }
}

function handleSearch() {
    const term = document.getElementById('search-fixtures').value.toLowerCase();
    const fixtureElements = Array.from(document.querySelectorAll('.draggable-fixture'));
    const listElements = Array.from(document.querySelectorAll('#fixture-list .subscription-item'));
    const fixturesMap = new Map(fixtures.map(f => [f.uid, f]));
    
    requestAnimationFrame(() => {
        fixtureElements.forEach(el => {
            const f = fixturesMap.get(el.dataset.uid);
            if (!term) el.classList.remove('dimmed');
            else { 
                if (f && (f.fid.toLowerCase().includes(term) || (f.type && f.type.toLowerCase().includes(term)))) el.classList.remove('dimmed'); 
                else el.classList.add('dimmed'); 
            }
        });
        listElements.forEach(el => {
            const f = fixturesMap.get(el.dataset.uid);
            if (!term) el.style.display = 'flex';
            else { 
                if (f && (f.fid.toLowerCase().includes(term) || (f.type && f.type.toLowerCase().includes(term)))) el.style.display = 'flex'; 
                else el.style.display = 'none'; 
            }
        });
    });
}

function getFixtureColor(fidStr) {
    const fid = parseInt(fidStr); if (isNaN(fid)) return { border: '#555555', bg: 'rgba(85,85,85,0.2)' };
    const p = [{ border: '#555555', bg: 'rgba(85,85,85,0.2)' }, { border: '#2979ff', bg: 'rgba(41,121,255,0.15)' }, { border: '#00e676', bg: 'rgba(0,230,118,0.15)' }, { border: '#ff5252', bg: 'rgba(255,82,82,0.15)' }, { border: '#ff9100', bg: 'rgba(255,145,0,0.15)' }, { border: '#e040fb', bg: 'rgba(224,64,251,0.15)' }, { border: '#1de9b6', bg: 'rgba(29,233,182,0.15)' }, { border: '#ffc400', bg: 'rgba(255,196,0,0.15)' }, { border: '#f50057', bg: 'rgba(245,0,87,0.15)' }, { border: '#00b0ff', bg: 'rgba(0,176,255,0.15)' }, { border: '#c6ff00', bg: 'rgba(198,255,0,0.15)' } ];
    return p[Math.floor(fid / 100) % p.length];
}

function handleMainAction() { if (activeFixtureIds.length > 0) duplicateSelected(); else addNewFixtureFromDraft(); }

function addNewFixtureFromDraft() {
    const rect = viewport.getBoundingClientRect(); const viewCenterX = (-panX + (rect.width / 2)) / currentZoom; const viewCenterY = (-panY + (rect.height / 2)) / currentZoom;
    let staggerOffset = (fixtures.length % 5) * 20; let spawnX = Math.round(viewCenterX / 20) * 20 - 30 + staggerOffset; let spawnY = Math.round(viewCenterY / 20) * 20 - 30 + staggerOffset; 
    let valFid = inpId.value || nextFid.toString(); let valType = inpType.value || ""; let valSrc = inpSrc.value || "";
    fixtures.push({ uid: generateUUID(), x: spawnX, y: spawnY, fid: valFid, type: valType, srcFid: valSrc });
    let numFid = parseInt(valFid); if (!isNaN(numFid) && numFid >= nextFid) nextFid = numFid + 1;
    render(); selectFixtures([fixtures[fixtures.length-1].uid]); saveState();
}

function copySelectionAsSource() {
    if (activeFixtureIds.length === 0) return;
    copiedMemoryFids = activeFixtureIds
        .map(uid => fixtures.find(f => f.uid === uid))
        .filter(f => f !== undefined)
        .map(f => f.fid);
    btnMemPaste.disabled = false;
    showToast(`Copied ${copiedMemoryFids.length} fixtures to memory`, 'success');
}

function pasteSourcesToSelection() {
    if (copiedMemoryFids.length === 0) return showToast("No sources in memory!", "error"); if (activeFixtureIds.length === 0) return showToast("Select target fixtures first!", "error");
    activeFixtureIds.forEach((uid, index) => { let f = fixtures.find(fx => fx.uid === uid); if(f) f.srcFid = copiedMemoryFids[index % copiedMemoryFids.length]; });
    saveState(); updateInspectorForm(); render(); autoFillMacroName(); showToast(`Applied sources to ${activeFixtureIds.length} targets`, 'success');
}

function saveState() {
    if(isUndoing) return; 
    if (historyIndex >= 0 && stateHistory[historyIndex]) {
        if (JSON.stringify(fixtures) === JSON.stringify(stateHistory[historyIndex].fixtures)) return;
    }
    if (historyIndex < stateHistory.length - 1) stateHistory = stateHistory.slice(0, historyIndex + 1);
    stateHistory.push(JSON.parse(JSON.stringify({ fixtures, nextFid, macroPool }))); if (stateHistory.length > 30) stateHistory.shift(); else historyIndex++;
    updateUndoRedoUI();
    

}
function undo() { if (historyIndex > 0) { historyIndex--; isUndoing = true; const snap = JSON.parse(JSON.stringify(stateHistory[historyIndex])); fixtures = snap.fixtures; nextFid = snap.nextFid; macroPool = snap.macroPool; activeFixtureIds = activeFixtureIds.filter(id => fixtures.some(f => f.uid === id)); render(); selectFixtures(activeFixtureIds); isUndoing = false; updateUndoRedoUI(); showToast("Undo", "info"); } }
function redo() { if (historyIndex < stateHistory.length - 1) { historyIndex++; isUndoing = true; const snap = JSON.parse(JSON.stringify(stateHistory[historyIndex])); fixtures = snap.fixtures; nextFid = snap.nextFid; macroPool = snap.macroPool; activeFixtureIds = activeFixtureIds.filter(id => fixtures.some(f => f.uid === id)); render(); selectFixtures(activeFixtureIds); isUndoing = false; updateUndoRedoUI(); showToast("Redo", "info"); } }
function updateUndoRedoUI() { btnUndo.disabled = historyIndex <= 0; btnRedo.disabled = historyIndex >= stateHistory.length - 1; }

window.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName; const isTyping = (tag === 'INPUT' || tag === 'SELECT') && !document.activeElement.disabled; if (isTyping) return; 
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectFixtures(fixtures.map(f=>f.uid)); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { if(activeFixtureIds.length > 0) { e.preventDefault(); copySelectionAsSource(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { if(activeFixtureIds.length > 0 && copiedMemoryFids.length > 0) { e.preventDefault(); pasteSourcesToSelection(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && activeFixtureIds.length > 0) {
        e.preventDefault(); const step = e.shiftKey ? 1 : 20; 
        activeFixtureIds.forEach(id => {
            const f = fixtures.find(fx => fx.uid === id); if (!f) return;
            if (e.key === 'ArrowLeft')  f.x -= step; if (e.key === 'ArrowRight') f.x += step;
            if (e.key === 'ArrowUp')    f.y -= step; if (e.key === 'ArrowDown')  f.y += step;
            const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); if (fEl) { fEl.style.left = `${f.x}px`; fEl.style.top = `${f.y}px`; }
        });
        clearTimeout(window._nudgeTimer); window._nudgeTimer = setTimeout(() => saveState(), 500);
    }
});

function duplicateSelected() {
    if (activeFixtureIds.length === 0) return; let newIds = [];
    const sortedSelected = fixtures.filter(f => activeFixtureIds.includes(f.uid)).sort((a,b) => { if(Math.abs(a.y - b.y) > 20) return a.y - b.y; return a.x - b.x; });
    const incrementAmount = sortedSelected.length;
    sortedSelected.forEach(f => {
        let clone = JSON.parse(JSON.stringify(f)); clone.uid = generateUUID(); clone.x += 80; clone.y += 0; 
        let numFid = parseInt(clone.fid); if (!isNaN(numFid)) clone.fid = (numFid + incrementAmount).toString();
        if (clone.srcFid && clone.srcFid !== "") { let numSrc = parseInt(clone.srcFid); if (!isNaN(numSrc)) clone.srcFid = (numSrc + incrementAmount).toString(); }
        fixtures.push(clone); newIds.push(clone.uid);
    });
    saveState(); handleSearch(); render(); selectFixtures(newIds); showToast(`Duplicated ${incrementAmount} fixtures`, 'success');
}

function clearSources() {
    if (activeFixtureIds.length === 0) return;
    activeFixtureIds.forEach(id => { const f = fixtures.find(fx => fx.uid === id); if(f) f.srcFid = ""; });
    saveState(); updateInspectorForm(); render(); showToast("Sources cleared", "info");
}

function deleteSelected() { if(activeFixtureIds.length === 0) return; fixtures = fixtures.filter(f => !activeFixtureIds.includes(f.uid)); selectFixtures([]); handleSearch(); render(); saveState(); showToast("Fixtures deleted", "info"); }

function updateCanvasTransform() { workspaceCanvas.style.transformOrigin = "0 0"; workspaceCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`; zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`; viewport.style.backgroundPosition = `${panX}px ${panY}px`; viewport.style.backgroundSize = `${20 * currentZoom}px ${20 * currentZoom}px`; }
viewport.addEventListener('wheel', (e) => { if (e.target.closest('.fixtures-panel') || e.target.closest('.pool-panel')) return; toggleFixturesPanel('close'); togglePoolPanel('close'); e.preventDefault(); const rect = viewport.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const canvasX = (mouseX - panX) / currentZoom; const canvasY = (mouseY - panY) / currentZoom; const zoomMultiplier = e.deltaY > 0 ? 0.85 : 1.15; let newZoom = currentZoom * zoomMultiplier; newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM)); panX = mouseX - (canvasX * newZoom); panY = mouseY - (canvasY * newZoom); currentZoom = newZoom; updateCanvasTransform(); }, { passive: false });
function adjustZoomButton(delta) { const rect = viewport.getBoundingClientRect(); const centerX = rect.width / 2; const centerY = rect.height / 2; const canvasX = (centerX - panX) / currentZoom; const canvasY = (centerY - panY) / currentZoom; let newZoom = currentZoom + (delta * currentZoom); newZoom = Math.max(MIN_ZOOM, Math.min(newZoom, MAX_ZOOM)); panX = centerX - (canvasX * newZoom); panY = centerY - (canvasY * newZoom); currentZoom = newZoom; updateCanvasTransform(); }

// ─── MULTITOUCH: Pinch-to-zoom + 2-finger pan ────────────────────────────────
// Works alongside the existing pointer-event fixture drag (1 finger = drag/select).
// When the user places a second finger, we switch to pan+zoom mode.
let _touchState = null;
function _getTouchMidpoint(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}
function _getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        // Cancel any active pointer-based pan/box-select so they don't conflict
        isPanning = false; isBoxSelecting = false; selectionBox.style.display = 'none';
        const t1 = e.touches[0], t2 = e.touches[1];
        _touchState = {
            startDist: _getTouchDist(t1, t2),
            startZoom: currentZoom,
            startPanX: panX,
            startPanY: panY,
            startMid: _getTouchMidpoint(t1, t2),
            rect: viewport.getBoundingClientRect()
        };
        e.preventDefault();
    }
}, { passive: false });

viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && _touchState) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const mid = _getTouchMidpoint(t1, t2);
        const dist = _getTouchDist(t1, t2);
        const rect = _touchState.rect;

        // Zoom around the pinch midpoint
        const scale = dist / _touchState.startDist;
        let newZoom = Math.max(MIN_ZOOM, Math.min(_touchState.startZoom * scale, MAX_ZOOM));

        // Midpoint on canvas at gesture start
        const originX = (_touchState.startMid.x - rect.left - _touchState.startPanX) / _touchState.startZoom;
        const originY = (_touchState.startMid.y - rect.top  - _touchState.startPanY) / _touchState.startZoom;

        // Pan offset from finger translation
        const panDX = mid.x - _touchState.startMid.x;
        const panDY = mid.y - _touchState.startMid.y;

        panX = (_touchState.startMid.x - rect.left) - originX * newZoom + panDX;
        panY = (_touchState.startMid.y - rect.top)  - originY * newZoom + panDY;

        currentZoom = newZoom;
        workspaceCanvas.classList.add('no-transition');
        viewport.classList.add('no-transition');
        updateCanvasTransform();
    }
}, { passive: false });

viewport.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        if (_touchState) {
            workspaceCanvas.classList.remove('no-transition');
            viewport.classList.remove('no-transition');
        }
        _touchState = null;
    }
}, { passive: true });

// ─── MODAL TOUCH-DISMISS ──────────────────────────────────────────────────────
// Tap outside modal content (on the dark overlay) closes the modal on touchscreen
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) {
            const id = overlay.id;
            // Don't dismiss the loading spinner overlay
            if (id === 'loading-overlay') return;
            closeModal(id);
        }
    });
});

let isPanning = false; let startPanMouseX, startPanMouseY; let startPanX, startPanY; let isBoxSelecting = false; let startSelMouseX, startSelMouseY;

viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.fixtures-panel') || e.target.closest('.pool-panel')) return; 
    toggleFixturesPanel('close'); togglePoolPanel('close');
    if (e.button === 1 || (e.button === 0 && e.ctrlKey) || e.button === 2) { 
        e.preventDefault(); isPanning = true; viewport.style.cursor = 'grabbing'; startPanMouseX = e.clientX; startPanMouseY = e.clientY; startPanX = panX; startPanY = panY; 
        viewport.classList.add('no-transition'); workspaceCanvas.classList.add('no-transition');
        return; 
    }
    if (e.button === 0 && (e.target === viewport || e.target === workspaceCanvas)) { isBoxSelecting = true; const rect = viewport.getBoundingClientRect(); startSelMouseX = e.clientX - rect.left; startSelMouseY = e.clientY - rect.top; selectionBox.style.left = `${startSelMouseX}px`; selectionBox.style.top = `${startSelMouseY}px`; selectionBox.style.width = `0px`; selectionBox.style.height = `0px`; selectionBox.style.display = 'block'; if (!e.shiftKey) selectFixtures([]); viewport.setPointerCapture(e.pointerId); }
});

window.addEventListener('pointermove', (e) => {
    if (isPanning) { panX = startPanX + (e.clientX - startPanMouseX); panY = startPanY + (e.clientY - startPanMouseY); updateCanvasTransform(); }
    if (isBoxSelecting) { const rect = viewport.getBoundingClientRect(); const currX = e.clientX - rect.left; const currY = e.clientY - rect.top; const x = Math.min(startSelMouseX, currX); const y = Math.min(startSelMouseY, currY); const w = Math.abs(currX - startSelMouseX); const h = Math.abs(currY - startSelMouseY); selectionBox.style.left = `${x}px`; selectionBox.style.top = `${y}px`; selectionBox.style.width = `${w}px`; selectionBox.style.height = `${h}px`; }
});

window.addEventListener('pointerup', (e) => {
    if (isPanning) { 
        isPanning = false; viewport.style.cursor = 'default'; 
        viewport.classList.remove('no-transition'); workspaceCanvas.classList.remove('no-transition');
    }
    if (isBoxSelecting) {
        isBoxSelecting = false; selectionBox.style.display = 'none'; if (viewport.hasPointerCapture && viewport.hasPointerCapture(e.pointerId)) { viewport.releasePointerCapture(e.pointerId); }
        const rect = viewport.getBoundingClientRect(); const currX = e.clientX - rect.left; const currY = e.clientY - rect.top; const selLeft = Math.min(startSelMouseX, currX); const selRight = Math.max(startSelMouseX, currX); const selTop = Math.min(startSelMouseY, currY); const selBottom = Math.max(startSelMouseY, currY); if (Math.abs(selRight - selLeft) < 5 && Math.abs(selBottom - selTop) < 5) return;
        let dx = currX - startSelMouseX; let dy = currY - startSelMouseY; let primaryAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; let dirX = dx > 0 ? 1 : -1; let dirY = dy > 0 ? 1 : -1;
        const cSelLeft = (selLeft - panX) / currentZoom; const cSelRight = (selRight - panX) / currentZoom; const cSelTop = (selTop - panY) / currentZoom; const cSelBottom = (selBottom - panY) / currentZoom;
        let caughtFixtures = []; fixtures.forEach(f => { const blockEl = document.querySelector(`.draggable-fixture[data-uid="${f.uid}"]`); if (blockEl && blockEl.classList.contains('dimmed')) return; if (f.x < cSelRight && f.x + 60 > cSelLeft && f.y < cSelBottom && f.y + 60 > cSelTop) caughtFixtures.push(f); });
        caughtFixtures.sort((a, b) => { if (primaryAxis === 'x') { if (Math.abs(a.x - b.x) > 20) return (a.x - b.x) * dirX; return (a.y - b.y) * dirY; } else { if (Math.abs(a.y - b.y) > 20) return (a.y - b.y) * dirY; return (a.x - b.x) * dirX; } });
        let newlySelectedIds = caughtFixtures.map(f => f.uid); if (e.shiftKey) { let uniqueNew = newlySelectedIds.filter(id => !activeFixtureIds.includes(id)); selectFixtures([...activeFixtureIds, ...uniqueNew]); } else { selectFixtures(newlySelectedIds); }
    }
});
window.addEventListener('contextmenu', e => e.preventDefault());

function zoomToFit() { if (fixtures.length === 0) return; let boundingMinX = Math.min(...fixtures.map(f => f.x)); let boundingMinY = Math.min(...fixtures.map(f => f.y)); let boundingMaxX = Math.max(...fixtures.map(f => f.x + 60)); let boundingMaxY = Math.max(...fixtures.map(f => f.y + 60)); let contentW = boundingMaxX - boundingMinX; let contentH = boundingMaxY - boundingMinY; const padding = 100; const rect = viewport.getBoundingClientRect(); const scaleX = (rect.width - padding * 2) / (contentW || 1); const scaleY = (rect.height - padding * 2) / (contentH || 1); let targetZoom = Math.max(MIN_ZOOM, Math.min(scaleX, scaleY, 1.5)); const centerX = boundingMinX + (contentW / 2); const centerY = boundingMinY + (contentH / 2); panX = (rect.width / 2) - (centerX * targetZoom); panY = (rect.height / 2) - (centerY * targetZoom); currentZoom = targetZoom; updateCanvasTransform(); }

function addCurrentToMacroPool() {
    let mName = document.getElementById('macro-name').value || "CLONE FIXTURES"; let mIndex = document.getElementById('macro-index').value || "1";
    let validLinks = fixtures.filter(f => f.fid && f.srcFid); if(validLinks.length === 0) return showToast("No Target & Source links found!", "error");
    let lines = validLinks.map(f => `Fixture ${f.fid} At Fixture ${f.srcFid}`); let existingIdx = macroPool.findIndex(m => m.index === mIndex);
    if (existingIdx > -1) macroPool[existingIdx] = { index: mIndex, name: mName, lines: lines }; else macroPool.push({ index: mIndex, name: mName, lines: lines });
    
    document.getElementById('macro-index').value = parseInt(mIndex) + 1; document.getElementById('macro-name').value = ""; 
    
    fixtures.forEach(f => f.srcFid = ""); 
    selectFixtures([]); 
    saveState(); render(); renderMacroPool(); updateInspectorForm(); autoFillMacroName();
    showToast(`Saved Macro [${mIndex}] to pool and cleared layout!`, 'success');
}

function autoFillMacroName() {
    let nameInput = document.getElementById('macro-name');
    if (!nameInput) return;
    let currentVal = nameInput.value.trim();
    let linked = null;
    if (activeFixtureIds.length > 0) {
        linked = fixtures.find(f => activeFixtureIds.includes(f.uid) && f.srcFid && f.srcFid !== "");
    }
    if (!linked) linked = fixtures.find(f => f.srcFid && f.srcFid !== "");
    
    if (linked) {
        let targetType = (linked.type && linked.type.trim() !== "") ? linked.type.trim() : "TARGET";
        let sourceFixture = fixtures.find(f => f.fid === linked.srcFid);
        let sourceType = (sourceFixture && sourceFixture.type && sourceFixture.type.trim() !== "") ? sourceFixture.type.trim() : "SOURCE";
        let suggestedName = `${sourceType} > ${targetType}`;
        if (currentVal === "" || currentVal.includes(" > ")) nameInput.value = suggestedName;
    } else {
        if (currentVal.includes(" > ")) nameInput.value = "";
    }
}

function deleteFromPool(index, event) { 
    if(event) event.stopPropagation(); 
    macroPool = macroPool.filter(m => m.index !== index); renderMacroPool(); 
}

function loadMacroToLayout(index) {
    let m = macroPool.find(mac => mac.index == index);
    if (!m) return;
    fixtures.forEach(f => f.srcFid = ""); 
    m.lines.forEach(line => {
        let parts = line.split(" At Fixture ");
        if (parts.length === 2) {
            let targetFid = parts[0].replace("Fixture ", "").trim();
            let srcFid = parts[1].trim();
            let f = fixtures.find(fx => fx.fid == targetFid);
            if (f) f.srcFid = srcFid;
        }
    });
    saveState(); render(); updateInspectorForm();
    showToast(`Loaded Macro [${m.index}] links to layout`, "info");
}

function renderMacroPool() {
    const container = document.getElementById('macro-pool-list'); container.innerHTML = "";
    macroPool.sort((a,b) => parseInt(a.index) - parseInt(b.index)).forEach(m => {
        let el = document.createElement('div'); el.className = "subscription-item"; 
        el.onclick = (e) => {
            if(e.target.tagName.toLowerCase() === 'button') return;
            loadMacroToLayout(m.index);
        };
        el.innerHTML = `<div class="subscription-info"><div class="subscription-username"><span style="color: var(--accent-color); margin-right: 4px;">[${m.index}]</span> ${m.name}</div><div class="subscription-meta">${m.lines.length} command lines</div></div><button onclick="deleteFromPool('${m.index}', event)" class="btn-delete">✕</button>`; container.appendChild(el);
    });
    let panelCount = document.getElementById('pool-count-panel'); if(panelCount) panelCount.textContent = macroPool.length;
}

function updateInspectorForm() {
    let alignPanel = document.getElementById('align-panel');
    if (alignPanel) alignPanel.style.display = (activeFixtureIds.length > 1) ? 'grid' : 'none';

    if (activeFixtureIds.length === 1) {
        const f = fixtures.find(fx => fx.uid === activeFixtureIds[0]); inspectorTitle.textContent = "Fixture Inspector"; btnMainAction.textContent = "Clone Setup"; memPanel.style.display = "block"; inpId.disabled = false; inpSrc.disabled = false; inpType.disabled = false; btnMainAction.disabled = false; btnMemPaste.disabled = (copiedMemoryFids.length === 0); inpId.value = f.fid; inpSrc.value = f.srcFid; inpType.value = (f.type && f.type.trim() !== "") ? f.type : ""; inpId.placeholder = "Target ID"; inpSrc.placeholder = "Source ID"; inpType.placeholder = "Fixture Type";
    } else if (activeFixtureIds.length > 1) {
        inspectorTitle.textContent = "Multi-Fixture Inspector"; btnMainAction.textContent = "Clone Setup"; memPanel.style.display = "block"; inpId.disabled = false; inpSrc.disabled = false; inpType.disabled = false; btnMainAction.disabled = false; btnMemPaste.disabled = (copiedMemoryFids.length === 0);
        const allSameId = activeFixtureIds.every(id => fixtures.find(fx=>fx.uid===id)?.fid === fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.fid); const allSameSrc = activeFixtureIds.every(id => fixtures.find(fx=>fx.uid===id)?.srcFid === fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.srcFid); const allSameType = activeFixtureIds.every(id => fixtures.find(fx=>fx.uid===id)?.type === fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.type);
        inpId.value = allSameId ? fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.fid : ''; inpSrc.value = allSameSrc ? fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.srcFid : ''; inpType.value = (allSameType && fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.type.trim() !== "") ? fixtures.find(fx=>fx.uid===activeFixtureIds[0])?.type : ''; inpId.placeholder = allSameId ? '' : 'Mixed values'; inpSrc.placeholder = allSameSrc ? '' : 'Mixed values'; inpType.placeholder = allSameType ? 'Fixture Type' : 'Mixed types';
    } else {
        inspectorTitle.textContent = "Draft New Fixture"; btnMainAction.textContent = "Add to Layout"; memPanel.style.display = "none"; inpId.disabled = false; inpSrc.disabled = false; inpType.disabled = false; btnMainAction.disabled = false; 
        if (document.activeElement !== inpId && document.activeElement !== inpSrc && document.activeElement !== inpType) { inpId.value = nextFid; inpSrc.value = ""; inpType.value = ""; }
        inpId.placeholder = "Target ID"; inpSrc.placeholder = "Source ID"; inpType.placeholder = "Fixture Type";
    }
}

function selectFixtures(idsArray) {
    activeFixtureIds = idsArray; updateInspectorForm();
    document.querySelectorAll('#fixture-list .subscription-item').forEach(el => { if(activeFixtureIds.includes(el.dataset.uid)) el.classList.add('active'); else el.classList.remove('active'); });
    document.querySelectorAll('.draggable-fixture').forEach(el => {
        const uid = el.dataset.uid; const isActive = activeFixtureIds.includes(uid);
        if (isActive) { el.classList.add('active'); el.style.zIndex = "50"; let badge = el.querySelector('.selection-order-badge'); if (activeFixtureIds.length > 1) { if (!badge) { badge = document.createElement('div'); badge.className = 'selection-order-badge'; el.insertBefore(badge, el.firstChild); } badge.textContent = activeFixtureIds.indexOf(uid) + 1; badge.style.display = 'flex'; } else if (badge) { badge.style.display = 'none'; } } else { el.classList.remove('active'); el.style.zIndex = "1"; let badge = el.querySelector('.selection-order-badge'); if (badge) badge.style.display = 'none'; }
    });
}

[inpId, inpSrc, inpType].forEach(input => {
    input.addEventListener('change', () => { if(activeFixtureIds.length > 0) saveState(); }); 
    input.addEventListener('input', (e) => {
        if (e.target.id === 'f-id' || e.target.id === 'f-src') e.target.value = e.target.value.replace(/[^0-9]/g, '');
        if (activeFixtureIds.length === 0) return; 
        activeFixtureIds.forEach(id => {
            const f = fixtures.find(fx => fx.uid === id); if (!f) return;
            if (e.target.id === 'f-id') { f.fid = e.target.value; const blockEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); if(blockEl) { const fEl = blockEl.querySelector('.fix-id-label'); if(fEl) fEl.textContent = f.fid; const colors = getFixtureColor(f.fid); blockEl.style.borderTop = `4px solid ${colors.border}`; blockEl.style.backgroundColor = colors.bg; } }
            if (e.target.id === 'f-src') { f.srcFid = e.target.value; const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"] .fix-src-label`); if(fEl) { fEl.innerHTML = `At ${f.srcFid}`; fEl.style.display = f.srcFid ? 'block' : 'none'; } autoFillMacroName(); }
            if (e.target.id === 'f-type') { 
                f.type = e.target.value || ""; 
                let fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"] .fix-type-label`); 
                const blockEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); 
                if(!fEl && f.type.trim() !== "" && blockEl) { 
                    fEl = document.createElement('div'); fEl.className = 'fix-type-label'; blockEl.insertBefore(fEl, blockEl.querySelector('.fix-id-label')); 
                } 
                if(fEl) { fEl.textContent = f.type; fEl.style.display = (f.type.trim() !== "") ? 'block' : 'none'; } 
            }
        }); 
        document.querySelectorAll('#fixture-list .subscription-item.active').forEach(el => { const uid = el.dataset.uid; const f = fixtures.find(fx => fx.uid === uid); if(f) { let typeBadgeHtml = (f.type && f.type.trim() !== "") ? `<span class="type-badge">${f.type}</span>` : ""; el.querySelector('.subscription-username').innerHTML = `Fixture ${f.fid || '?'} ${typeBadgeHtml}`; el.querySelector('.subscription-meta').textContent = f.srcFid ? `<- copy from ${f.srcFid}` : 'No source mapped'; el.style.borderLeftColor = f.srcFid ? "var(--success-color)" : "transparent"; } });
    });
});

function render() {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        if (fixtures.length === 0) emptyState.style.display = 'flex';
        else emptyState.style.display = 'none';
    }

    const elementsInCanvas = workspaceCanvas.querySelectorAll('.draggable-fixture'); elementsInCanvas.forEach(el => { if (el._cleanupDrag) el._cleanupDrag(); el.remove(); }); fixtureList.innerHTML = ''; fixtureCountDisplay.textContent = `${fixtures.length} Fixtures`;
    let sortedFixtures = [...fixtures].sort((a, b) => parseInt(a.fid) - parseInt(b.fid));
    sortedFixtures.forEach((f) => {
        const isActive = activeFixtureIds.includes(f.uid);
        const listItem = document.createElement('div'); listItem.className = `subscription-item ${isActive ? 'active' : ''}`; listItem.dataset.uid = f.uid; listItem.style.borderLeftColor = f.srcFid ? "var(--success-color)" : "transparent";
        listItem.onclick = (e) => { const currentlyActive = activeFixtureIds.includes(f.uid); if (e.shiftKey) { if (currentlyActive) selectFixtures(activeFixtureIds.filter(id => id !== f.uid)); else selectFixtures([...activeFixtureIds, f.uid]); } else { selectFixtures([f.uid]); } }; 
        let typeBadgeHtml = (f.type && f.type.trim() !== "") ? `<span class="type-badge">${f.type}</span>` : "";
        listItem.innerHTML = `<div class="subscription-info"><div class="subscription-username">Fixture ${f.fid || '?'} ${typeBadgeHtml}</div><div class="subscription-meta">${f.srcFid ? `<- copy from ${f.srcFid}` : 'No source mapped'}</div></div><button onclick="deleteFixture('${f.uid}', event)" class="btn-delete" title="Delete">✕</button>`;
        fixtureList.appendChild(listItem);

        const el = document.createElement('div'); el.className = `draggable-fixture ${isActive ? 'active' : ''}`; el.dataset.uid = f.uid; el.style.left = `${f.x}px`; el.style.top = `${f.y}px`;
        const colors = getFixtureColor(f.fid); el.style.borderTop = `4px solid ${colors.border}`; el.style.backgroundColor = colors.bg; if(isActive) el.style.zIndex = "50";
        let badgeHtml = ""; if (isActive && activeFixtureIds.length > 1) { let orderIndex = activeFixtureIds.indexOf(f.uid) + 1; badgeHtml = `<div class="selection-order-badge" style="display:flex;">${orderIndex}</div>`; }
        
        let canvasTypeHtml = (f.type && f.type.trim() !== "") ? `<div class="fix-type-label">${f.type}</div>` : ""; 
        let srcDisplay = f.srcFid ? 'block' : 'none';
        
        el.innerHTML = `${badgeHtml}${canvasTypeHtml}<div class="fix-id-label">${f.fid || '?'}</div><div class="fix-src-label" style="display: ${srcDisplay};">At ${f.srcFid}</div>`;

        el.addEventListener('pointerdown', (e) => {
            toggleFixturesPanel('close'); togglePoolPanel('close'); if (e.button !== 0 || e.altKey) return; e.stopPropagation(); el.setPointerCapture(e.pointerId);
            let isAlreadySelected = activeFixtureIds.includes(f.uid);
            if (e.shiftKey) { if (isAlreadySelected) { selectFixtures(activeFixtureIds.filter(id => id !== f.uid)); return; } else { selectFixtures([...activeFixtureIds, f.uid]); } } else { if (!isAlreadySelected) { selectFixtures([f.uid]); } }
            
            activeFixtureIds.forEach(id => { const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); if (fEl) fEl.classList.add('is-dragging'); });

            let isDragBlock = true; let hasMoved = false; let startX = e.clientX; let startY = e.clientY;
            const initialPositions = {}; activeFixtureIds.forEach(id => { const fx = fixtures.find(sc => sc.uid === id); if(fx) initialPositions[id] = { x: fx.x, y: fx.y }; });
            let initialTargetX = initialPositions[f.uid].x; let initialTargetY = initialPositions[f.uid].y; document.querySelectorAll('.draggable-fixture.active').forEach(sel => sel.style.zIndex = 100);
            function onPointerMove(moveEvent) {
                if (!isDragBlock) return; const dx = (moveEvent.clientX - startX) / currentZoom; const dy = (moveEvent.clientY - startY) / currentZoom; if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true;
                let newTargetX = initialTargetX + dx; let newTargetY = initialTargetY + dy;
                let moveX = Math.round((initialPositions[f.uid].x + newTargetX - initialTargetX) / 20) * 20 - initialPositions[f.uid].x; let moveY = Math.round((initialPositions[f.uid].y + newTargetY - initialTargetY) / 20) * 20 - initialPositions[f.uid].y;
                activeFixtureIds.forEach(id => { const fx = fixtures.find(sc => sc.uid === id); if (fx) { fx.x = initialPositions[id].x + moveX; fx.y = initialPositions[id].y + moveY; const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); if (fEl) { fEl.style.left = `${fx.x}px`; fEl.style.top = `${fx.y}px`; } } });
            }
            function onPointerUp(upEvent) { 
                isDragBlock = false; if (el.hasPointerCapture && el.hasPointerCapture(upEvent.pointerId)) { el.releasePointerCapture(upEvent.pointerId); } 
                document.querySelectorAll('.draggable-fixture.active').forEach(sel => sel.style.zIndex = 50); 
                activeFixtureIds.forEach(id => { const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`); if (fEl) fEl.classList.remove('is-dragging'); });
                window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); el._cleanupDrag = null; if (hasMoved) { saveState(); } else { if (!e.shiftKey && activeFixtureIds.length > 1) selectFixtures([f.uid]); } 
            }
            window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp);
            el._cleanupDrag = () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); };
        });
        workspaceCanvas.appendChild(el);
    });
    updateInspectorForm(); handleSearch(); 
}

// --- MODALS & LOADING ---
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function updateLoadingOverlay(msg) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.textContent = msg;
    if (overlay) overlay.classList.add('active');
}
function hideLoadingOverlay() { 
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('active'); 
}

// --- ALIGNMENT ---
function alignSelectedX() {
    if (activeFixtureIds.length < 2) return showToast("Select at least 2 fixtures to align", "error");
    const firstF = fixtures.find(f => f.uid === activeFixtureIds[0]);
    if (!firstF) return;
    activeFixtureIds.forEach(id => {
        const f = fixtures.find(fx => fx.uid === id);
        if (f) {
            f.x = firstF.x;
            const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`);
            if (fEl) fEl.style.left = `${f.x}px`;
        }
    });
    saveState();
    showToast("Aligned horizontally", "success");
}

function alignSelectedY() {
    if (activeFixtureIds.length < 2) return showToast("Select at least 2 fixtures to align", "error");
    const firstF = fixtures.find(f => f.uid === activeFixtureIds[0]);
    if (!firstF) return;
    activeFixtureIds.forEach(id => {
        const f = fixtures.find(fx => fx.uid === id);
        if (f) {
            f.y = firstF.y;
            const fEl = document.querySelector(`.draggable-fixture[data-uid="${id}"]`);
            if (fEl) fEl.style.top = `${f.y}px`;
        }
    });
    saveState();
    showToast("Aligned vertically", "success");
}

function selectAllOfType() {
    if (activeFixtureIds.length === 0) return;
    const f = fixtures.find(fx => fx.uid === activeFixtureIds[0]);
    if (!f || !f.type || f.type.trim() === "") return showToast("Selected fixture has no type!", "error");
    const matchingIds = fixtures.filter(fx => fx.type === f.type).map(fx => fx.uid);
    selectFixtures(matchingIds);
    showToast(`Selected ${matchingIds.length} fixtures of type ${f.type}`, "info");
}

// --- INIT ---
panX = 200; panY = 200; updateCanvasTransform(); render(); saveState();