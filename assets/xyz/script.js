import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/addons/controls/OrbitControls.js';
import { RoomEnvironment } from '../lib/addons/environments/RoomEnvironment.js';

'use strict';
window.toggle3DView = toggle3DView;
window.runAutoMatch = runAutoMatch;
window.clearAllMappings = clearAllMappings;
window.importCaptureXML = importCaptureXML;
window.triggerSendToMA2 = triggerSendToMA2;
window.pullFromGrandMA2 = pullFromGrandMA2;
window.submitLogin = submitLogin;
window.closeModal = closeModal;
window.handleSearch = handleSearch;
window.toggleFilterUnmatched = toggleFilterUnmatched;
window.setVisualizerMode = setVisualizerMode;
window.toggleLabels = toggleLabels;

// ============================================================
// STATE
// ============================================================
let pyBridge = null;

const state = {
    ma2Fixtures: [],
    captureFixtures: [],
    ma2RawXML: '',
    // mappings[ma2_fixture_id] = captureFixture object | null
    mappings: {},
    // matchMethod[ma2_fixture_id] = 'auto' | 'manual' | null
    matchMethod: {},
    // flipZ[ma2_fixture_id] = true | false
    flipZ: {},
    filterUnmatched: false,
    searchQuery: '',
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    let checkInterval;
    function initBridge() {
        if (typeof qt !== 'undefined' && qt.webChannelTransport) {
            new QWebChannel(qt.webChannelTransport, ch => {
                window.pyBridge = ch.objects.backend;
                pyBridge = window.pyBridge;
                pyBridge.progress_update.connect(msg => {
                    const el = document.getElementById('loading-text');
                    if (el) el.textContent = msg;
                });
                if (pyBridge.patch_pulled) {
                    pyBridge.patch_pulled.connect(res_json => {
                        try {
                            const res = JSON.parse(res_json);
                            if (!res.success) {
                                hideLoading();
                                showToast(res.error, 'error');
                                setDot('ma2-dot', 'err');
                                document.getElementById('ma2-count').textContent = 'Error';
                                return;
                            }
                            state.ma2RawXML = res.data;
                    
                            document.getElementById('loading-text').textContent = 'Parsing MA2 patch...';
                            pyBridge.parse_ma2_patch(res.data, parsed_json => {
                                hideLoading();
                                try {
                                    const parsed = JSON.parse(parsed_json);
                                    if (!parsed.success) {
                                        showToast('Parse error: ' + parsed.error, 'error');
                                        return;
                                    }
                                    state.ma2Fixtures = parsed.data;
                                    const withPos = parsed.data.filter(f => f.has_position).length;
                                    setDot('ma2-dot', 'on');
                                    document.getElementById('ma2-count').textContent =
                                        `${parsed.data.length} fixtures (${withPos} have XYZ)`;
                                    document.getElementById('badge-ma2').classList.add('loaded');
                                    showToast(`MA2 patch loaded — ${parsed.data.length} fixtures`, 'success');
                                    tryAutoMatch();
                                } catch(e) { hideLoading(); showToast('Error parsing parsed patch response', 'error'); }
                            });
                        } catch (e) {
                            hideLoading();
                            showToast('Error parsing pull patch response', 'error');
                        }
                    });
                }
                if (pyBridge.macros_sent) {
                    pyBridge.macros_sent.connect(res_json => {
                        hideLoading();
                        try {
                            const res = JSON.parse(res_json);
                            if (!res.success) {
                                showToast(res.error, 'error');
                                return;
                            }
                            showToast(res.message || `Successfully sent ${res.count} XYZ mappings to MA2!`, 'success');
                        } catch (e) {
                            showToast('Error parsing send macro response', 'error');
                        }
                    });
                }
                pyBridge.get_local_ips(res => {
                    try {
                        const ips = JSON.parse(res);
                        const dl = document.getElementById('ip-list');
                        if (!dl) return;
                        ips.forEach(ip => {
                            const opt = document.createElement('option');
                            opt.value = ip.split(' - ')[0];
                            opt.label = ip;
                            dl.appendChild(opt);
                        });
                    } catch (e) {}
                });
            });
            clearInterval(checkInterval);
        }
    }
    checkInterval = setInterval(initBridge, 100);
    initBridge();
});

// ============================================================
// PULL FROM MA2 (opens login modal, same pattern as other tools)
// ============================================================
function pullFromGrandMA2() {
    if (!pyBridge) { showToast('Bridge not ready', 'error'); return; }
    if (pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            if (credsStr) {
                try {
                    const creds = JSON.parse(credsStr);
                    if (creds.ip && creds.ip.trim() !== '') {
                        showLoading('Connecting to MA2...');
                        pyBridge.pull_patch(credsStr);
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

    showLoading('Connecting to MA2...');
    pyBridge.pull_patch(JSON.stringify(creds));
}
// ============================================================
// IMPORT CAPTURE XML
// ============================================================
function importCaptureXML() {
    if (!pyBridge) { showToast('Bridge not ready', 'error'); return; }
    pyBridge.import_capture_xml(res_json => {
        const res = JSON.parse(res_json);
        if (!res.success) {
            if (res.error !== 'Cancelled') showToast(res.error, 'error');
            return;
        }
        showLoading('Parsing Capture XML...');
        pyBridge.parse_capture_xml(res.data, parsed_json => {
            hideLoading();
            const parsed = JSON.parse(parsed_json);
            if (!parsed.success) {
                showToast('Parse error: ' + parsed.error, 'error');
                setDot('cap-dot', 'err');
                document.getElementById('cap-count').textContent = 'Error';
                return;
            }
            state.captureFixtures = parsed.data;
            setDot('cap-dot', 'on');
            document.getElementById('cap-count').textContent =
                `${parsed.data.length} fixtures`;
            document.getElementById('badge-cap').classList.add('loaded');
            showToast(`Capture XML loaded — ${parsed.data.length} fixtures`, 'success');
            tryAutoMatch();
        });
    });
}

// ============================================================
// AUTO-MATCH — called automatically when both sources load,
// AND manually from the Auto-Match button in the header
// ============================================================
function runAutoMatch() {
    // Reset only auto-matches (keep manual ones)
    state.ma2Fixtures.forEach(mf => {
        if (state.matchMethod[mf.fixture_id] === 'auto') {
            state.mappings[mf.fixture_id]    = null;
            state.matchMethod[mf.fixture_id] = null;
        }
    });
    tryAutoMatch();
}

function tryAutoMatch() {
    if (!state.ma2Fixtures.length || !state.captureFixtures.length) {
        // Only one source loaded — just render whatever we have
        renderTable();
        if (is3DActive) update3DView();
        return;
    }

    // Build Capture lookup tables
    const byFixtureId = {};   // capture fixture_id → fixture
    const byDmx      = {};   // dmx_address → array of fixtures

    state.captureFixtures.forEach(cf => {
        if (cf.fixture_id && cf.fixture_id !== 0) {
            byFixtureId[cf.fixture_id] = cf;
        }
        if (cf.dmx_address && cf.dmx_address !== 0) {
            if (!byDmx[cf.dmx_address]) byDmx[cf.dmx_address] = [];
            byDmx[cf.dmx_address].push(cf);
        }
    });

    let autoCount = 0;
    state.ma2Fixtures.forEach(mf => {
        const id = mf.fixture_id;
        // Don't overwrite an existing manual mapping
        if (state.matchMethod[id] === 'manual') return;

        // Priority 1: DMX address match (Most reliable physical match)
        if (mf.dmx_address && byDmx[mf.dmx_address]) {
            const candidates = byDmx[mf.dmx_address];
            let found = candidates.find(c => c.fixture_id === id);
            let matched = candidates.length === 1 ? candidates[0] : (found || candidates[0]);
            state.mappings[id]     = matched;
            state.matchMethod[id]  = (candidates.length > 1 && !found) ? 'auto-ambiguous' : 'auto';
            autoCount++;
            return;
        }
        
        // Priority 2: fixture_id exact match
        if (byFixtureId[id]) {
            state.mappings[id]     = byFixtureId[id];
            state.matchMethod[id]  = 'auto';
            autoCount++;
            return;
        }
        // No match
        if (state.matchMethod[id] !== 'manual') {
            state.mappings[id]    = null;
            state.matchMethod[id] = null;
        }
    });

    showToast(`Auto-match: ${autoCount} of ${state.ma2Fixtures.length} fixtures matched`, autoCount > 0 ? 'success' : 'warning');
    renderTable();
    if (is3DActive) update3DView();
}

// ============================================================
// CLEAR ALL MAPPINGS
// ============================================================
function clearAllMappings() {
    state.mappings    = {};
    state.matchMethod = {};
    renderTable();
    showToast('All mappings cleared', 'info');
}

// ============================================================
// RENDERING
// ============================================================
function getVisibleFixtures() {
    let list = [...state.ma2Fixtures];
    if (state.filterUnmatched) {
        list = list.filter(f => !state.mappings[f.fixture_id]);
    }
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        list = list.filter(f =>
            String(f.fixture_id).includes(q) ||
            (f.name || '').toLowerCase().includes(q) ||
            (f.fixture_type || '').toLowerCase().includes(q) ||
            (f.layer || '').toLowerCase().includes(q)
        );
    }
    return list;
}

function renderTable() {
    const tbody   = document.getElementById('mapping-table');
    const empty   = document.getElementById('empty-state');
    const headers = document.getElementById('col-headers');

    // No MA2 data at all
    if (!state.ma2Fixtures.length) {
        empty.style.display  = 'flex';
        headers.style.display = 'none';
        tbody.innerHTML = '';
        tbody.appendChild(empty);
        updateStats();
        return;
    }

    headers.style.display = 'grid';
    const fixtures = getVisibleFixtures();

    // Sort: unmatched first, then ascending fixture_id
    fixtures.sort((a, b) => {
        const aM = !!state.mappings[a.fixture_id];
        const bM = !!state.mappings[b.fixture_id];
        if (aM !== bM) return aM ? 1 : -1;
        return a.fixture_id - b.fixture_id;
    });

    tbody.innerHTML = '';

    if (!fixtures.length) {
        const msg = document.createElement('div');
        msg.className = 'empty-state';
        msg.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <h3>No results found</h3>
            <p>No fixtures match the current filter or search query.</p>
        `;
        tbody.appendChild(msg);
        updateStats();
        return;
    }

    fixtures.forEach((mf, idx) => {
        tbody.appendChild(buildRow(mf, idx));
    });

    updateStats();
    refreshInjectButton();
    setEnabled('btn-clear-match', Object.keys(state.mappings).length > 0);
}

function buildRow(mf, idx) {
    const id     = mf.fixture_id;
    const mapped = state.mappings[id];
    const method = state.matchMethod[id]; // 'auto' | 'manual' | null

    const row = document.createElement('div');
    row.id = `row-${id}`;
    row.className = `mapping-row ${method ? `mapped-${method}` : 'unmapped'}`;
    row.style.animationDelay = `${Math.min(idx * 0.015, 0.25)}s`;

    // 1. FID
    const fidCol = document.createElement('div');
    fidCol.className = 'fix-id';
    fidCol.textContent = id;
    row.appendChild(fidCol);

    // 2. MA2 Name
    const nameCol = document.createElement('div');
    nameCol.className = 'fix-name-group';
    nameCol.innerHTML = `
        <div class="fix-name" title="${esc(mf.name)} — ${esc(mf.fixture_type)}">${esc(mf.name)}</div>
        <div class="fix-meta">
            <span class="pos-badge ${mf.has_position ? 'has' : 'none'}">${mf.has_position ? 'XYZ' : 'No XYZ'}</span>
            <span>${esc(mf.layer)}</span>
        </div>`;
    row.appendChild(nameCol);

    // 3. Capture Dropdown
    const capCol = document.createElement('div');
    const select = document.createElement('select');
    select.className = 'cap-select';
    select.dataset.ma2Id = id;

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Select Source —';
    select.appendChild(noneOpt);

    state.captureFixtures.forEach(cf => {
        const opt = document.createElement('option');
        opt.value = `${cf.fixture_id}__${cf.dmx_address}`;
        opt.textContent = `ID ${cf.fixture_id} | ${cf.name} [${cf.layer}]`;
        if (mapped && cf.fixture_id === mapped.fixture_id && cf.dmx_address === mapped.dmx_address) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });

    select.addEventListener('change', e => onDropdownChange(id, e.target.value));
    capCol.appendChild(select);
    row.appendChild(capCol);

    // 4. Status Text
    const statusCol = document.createElement('div');
    statusCol.style.textAlign = 'center';
    let statusLabel = 'None';
    if (method === 'auto') statusLabel = 'Auto';
    if (method === 'auto-ambiguous') statusLabel = 'Auto (Ambiguous)';
    if (method === 'manual') statusLabel = 'Manual';
    statusCol.innerHTML = `<span class="status-text">${statusLabel}</span>`;
    row.appendChild(statusCol);

    // 5. Flip Z Toggle
    const flipCol = document.createElement('div');
    flipCol.className = 'flip-toggle-wrapper';
    if (mapped) {
        if (state.flipZ[id] === undefined) {
            const isBeam = (mf.fixture_type && mf.fixture_type.toLowerCase().includes('beam')) ||
                           (mf.name && mf.name.toLowerCase().includes('beam')) ||
                           (mf.layer && mf.layer.toLowerCase().includes('beam')) ||
                           (mapped.name && mapped.name.toLowerCase().includes('beam'));
            state.flipZ[id] = isBeam;
        }
        
        const toggleBtn = document.createElement('div');
        toggleBtn.className = `toggle-switch ${state.flipZ[id] ? 'active' : ''}`;
        toggleBtn.title = "Flip Z 180°";
        toggleBtn.onclick = () => {
            state.flipZ[id] = !state.flipZ[id];
            toggleBtn.classList.toggle('active', state.flipZ[id]);
        };
        flipCol.appendChild(toggleBtn);
    }
    row.appendChild(flipCol);

    return row;
}

function onDropdownChange(ma2Id, value) {
    if (!value) {
        state.mappings[ma2Id]    = null;
        state.matchMethod[ma2Id] = null;
    } else {
        const [fidStr, dmxStr] = value.split('__');
        const fid = parseInt(fidStr, 10);
        const dmx = parseInt(dmxStr, 10);
        const cf  = state.captureFixtures.find(f => f.fixture_id === fid && f.dmx_address === dmx);
        state.mappings[ma2Id]    = cf || null;
        state.matchMethod[ma2Id] = cf ? 'manual' : null;
    }
    const mf = state.ma2Fixtures.find(f => f.fixture_id == ma2Id);
    if (mf) {
        const oldRow = document.getElementById(`row-${ma2Id}`);
        if (oldRow) {
            const newRow = buildRow(mf, 0);
            newRow.style.animationDelay = '0s';
            oldRow.replaceWith(newRow);
        }
    }
    updateStats();
    refreshInjectButton();
    setEnabled('btn-clear-match', Object.keys(state.mappings).length > 0);
}

// Global function to handle Flip Z checkbox
window.toggleFlipZ = function(ma2Id, isChecked) {
    state.flipZ[ma2Id] = isChecked;
};

// ============================================================
// STATS
// ============================================================
function updateStats() {
    let auto = 0, manual = 0, none = 0;
    state.ma2Fixtures.forEach(mf => {
        const m = state.matchMethod[mf.fixture_id];
        if (m === 'auto' || m === 'auto-ambiguous') auto++;
        else if (m === 'manual') manual++;
        else none++;
    });
    setText('stat-auto',   auto);
    setText('stat-manual', manual);
    setText('stat-none',   none);
    return { auto, manual, none };
}

function refreshInjectButton() {
    const { auto, manual } = updateStats();
    const ok = (auto + manual) > 0 && state.ma2RawXML.length > 0;
    setEnabled('btn-inject', ok);
    const bothLoaded = state.ma2Fixtures.length > 0 && state.captureFixtures.length > 0;
    setEnabled('btn-automatch', bothLoaded);
}

// ============================================================
// FILTER & SEARCH
// ============================================================
function toggleFilterUnmatched() {
    state.filterUnmatched = !state.filterUnmatched;
    const btn = document.getElementById('btn-show-unmatched');
    if (btn) {
        btn.classList.toggle('active', state.filterUnmatched);
        btn.textContent = state.filterUnmatched ? 'Show All' : 'Show Unmatched';
    }
    renderTable();
}

function handleSearch() {
    state.searchQuery = document.getElementById('search-input').value.trim();
    renderTable();
}

// ============================================================
// SEND TO MA2 VIA MACRO (Telnet)
// ============================================================
function triggerSendToMA2() {
    if (!state.ma2RawXML) {
        showToast('No MA2 patch loaded. Pull it first.', 'error');
        return;
    }
    const payload = {};
    state.ma2Fixtures.forEach(mf => {
        const cf = state.mappings[mf.fixture_id];
        if (!cf) return;
        let rotZ = parseFloat(cf.rot_z) || 0;
        if (state.flipZ[mf.fixture_id]) {
            rotZ += 180;
        }

        payload[mf.fixture_id] = {
            ma2_fixture_id: mf.fixture_id,
            pos_x: cf.pos_x, pos_y: cf.pos_y, pos_z: cf.pos_z,
            rot_x: cf.rot_x, rot_y: cf.rot_y, rot_z: rotZ,
        };
    });
    if (Object.keys(payload).length === 0) {
        showToast('No fixtures mapped. Run Auto-Match first.', 'warning');
        return;
    }
    let ip       = (document.getElementById('login-ip').value || '').split(' ')[0] || '';
    let user     = document.getElementById('login-user').value || 'administrator';
    let password = document.getElementById('login-pass').value || 'admin';

    if (ip) {
        _doSend();
    } else {
        if (window.pyBridge && window.pyBridge.get_saved_credentials) {
            window.pyBridge.get_saved_credentials(function(credsStr) {
                if (credsStr) {
                    try {
                        const creds = JSON.parse(credsStr);
                        if (creds.ip) {
                            ip = creds.ip;
                            user = creds.user || 'administrator';
                            password = creds.password || 'admin';
                            
                            document.getElementById('login-ip').value = ip;
                            document.getElementById('login-user').value = user;
                            document.getElementById('login-pass').value = password;
                            
                            _doSend();
                            return;
                        }
                    } catch(e) {}
                }
                showToast('Enter the MA2 IP address first (Pull from MA2).', 'error');
            });
        } else {
            showToast('Enter the MA2 IP address first (Pull from MA2).', 'error');
        }
    }

    function _doSend() {
        const login = JSON.stringify({ ip, user, password });
        showLoading(`Sending positions directly to MA2 for ${Object.keys(payload).length} fixtures...`);
        pyBridge.send_xyz_macro(login, JSON.stringify(payload));
    }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ============================================================
// LOADING OVERLAY
// ============================================================
function showLoading(msg) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.textContent = msg || 'Working...';
    if (overlay) overlay.classList.add('active');
}
function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ============================================================
// TOAST
// ============================================================
function showToast(message, type = 'default', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const colors = { success: '#00e67660', error: '#ff525260', info: '#29b6f660', warning: '#ffa72660', default: 'rgba(255, 255, 255, 0.1)' };
    toast.style.borderColor = colors[type] || colors.default;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ============================================================
// UTILS
// ============================================================
function setDot(id, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'status-dot' + (cls ? ' ' + cls : '');
}
function setEnabled(id, val) {
    const el = document.getElementById(id);
    if (el) el.disabled = !val;
}
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function fmt(n) { return (typeof n === 'number' ? n : parseFloat(n) || 0).toFixed(3); }
// HTML Escape Helper
function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

// ============================================================
// 3D VISUALIZER
// ============================================================
let is3DActive = false;
let visualizerMode = 'split'; // 'split', 'ma2', 'capture'
let sceneMA2, cameraMA2, rendererMA2, controlsMA2;
let sceneCap, cameraCap, rendererCap, controlsCap;
let is3DInitialized = false;
let animationFrameId = null;

function toggle3DView() {
    is3DActive = !is3DActive;
    const btn = document.getElementById('btn-toggle-3d');
    const table = document.getElementById('data-table-view');
    const vis = document.getElementById('visualizer-view');
    
    if (is3DActive) {
        if (btn) {
            btn.classList.add('active');
            btn.style.color = '#fff';
            btn.style.backgroundColor = 'rgba(255,255,255,0.1)';
        }
        table.style.display = 'none';
        vis.style.display = 'flex';
        
        if (!is3DInitialized) {
            init3D();
        } else {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            animate3D();
        }
        update3DView();
        
        // Force resize check after layout
        setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
        
    } else {
        if (btn) {
            btn.classList.remove('active');
            btn.style.color = 'var(--accent-color)';
            btn.style.backgroundColor = '';
        }
        table.style.display = 'flex';
        vis.style.display = 'none';
    }
}

function setVisualizerMode(mode) {
    visualizerMode = mode;
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-view-' + mode).classList.add('active');
    
    const vpMA2 = document.getElementById('viewport-ma2');
    const vpCap = document.getElementById('viewport-capture');
    const div = document.getElementById('viewport-divider');
    
    if (mode === 'split') {
        vpMA2.style.flex = '1';
        vpMA2.style.opacity = '1';
        vpMA2.style.pointerEvents = 'auto';
        
        vpCap.style.flex = '1';
        vpCap.style.opacity = '1';
        vpCap.style.pointerEvents = 'auto';
        
        div.style.opacity = '1';
    } else if (mode === 'ma2') {
        vpMA2.style.flex = '1';
        vpMA2.style.opacity = '1';
        vpMA2.style.pointerEvents = 'auto';
        
        vpCap.style.flex = '0';
        vpCap.style.opacity = '0';
        vpCap.style.pointerEvents = 'none';
        
        div.style.opacity = '0';
    } else if (mode === 'capture') {
        vpMA2.style.flex = '0';
        vpMA2.style.opacity = '0';
        vpMA2.style.pointerEvents = 'none';
        
        vpCap.style.flex = '1';
        vpCap.style.opacity = '1';
        vpCap.style.pointerEvents = 'auto';
        
        div.style.opacity = '0';
    }
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
}

let elCanvasMA2 = null;
let elCanvasCap = null;

function init3D() {
    is3DInitialized = true;
    
    // DOM Cache
    elCanvasMA2 = document.getElementById('canvas-ma2');
    elCanvasCap = document.getElementById('canvas-capture');
    
    // MA2 Setup
    const cMA2 = elCanvasMA2;
    sceneMA2 = new THREE.Scene();
    sceneMA2.background = new THREE.Color(0x0a0a0a);
    
    cameraMA2 = new THREE.PerspectiveCamera(60, cMA2.clientWidth / cMA2.clientHeight, 0.1, 1000);
    cameraMA2.position.set(0, 5, 15);
    
    rendererMA2 = new THREE.WebGLRenderer({ antialias: true });
    rendererMA2.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererMA2.setSize(cMA2.clientWidth, cMA2.clientHeight);
    rendererMA2.outputColorSpace = THREE.SRGBColorSpace;
    cMA2.appendChild(rendererMA2.domElement);
    
    controlsMA2 = new OrbitControls(cameraMA2, rendererMA2.domElement);
    controlsMA2.enableDamping = true;
    controlsMA2.dampingFactor = 0.05;
    controlsMA2.autoRotate = true;
    controlsMA2.autoRotateSpeed = 0.3; // Slower rotation
    
    // MA2 Helpers
    sceneMA2.add(new THREE.GridHelper(40, 40, 0x333333, 0x222222));
    const axesMA2 = new THREE.AxesHelper(2);
    axesMA2.position.y = 0.01; // Prevent Z-fighting with grid
    sceneMA2.add(axesMA2);
    
    // Standard Lighting (MA2)
    const lightMA2 = new THREE.DirectionalLight(0xffffff, 1.5);
    lightMA2.position.set(10, 20, 10);
    sceneMA2.add(lightMA2);
    
    // Fill Light from opposite direction
    const fillLightMA2 = new THREE.DirectionalLight(0x90b0d0, 1.2);
    fillLightMA2.position.set(-10, 0, -10);
    sceneMA2.add(fillLightMA2);
    
    // Hemisphere Light for excellent ambient depth
    const hemiLightMA2 = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    sceneMA2.add(hemiLightMA2);
    sceneMA2.add(new THREE.AmbientLight(0x808080));
    
    // Capture Setup
    const cCap = elCanvasCap;
    sceneCap = new THREE.Scene();
    sceneCap.background = new THREE.Color(0x0a0a0a);
    
    cameraCap = new THREE.PerspectiveCamera(60, cCap.clientWidth / cCap.clientHeight, 0.1, 1000);
    cameraCap.position.set(0, 5, 15);
    
    rendererCap = new THREE.WebGLRenderer({ antialias: true });
    rendererCap.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererCap.setSize(cCap.clientWidth, cCap.clientHeight);
    rendererCap.outputColorSpace = THREE.SRGBColorSpace;
    cCap.appendChild(rendererCap.domElement);
    
    controlsCap = new OrbitControls(cameraCap, rendererCap.domElement);
    controlsCap.enableDamping = true;
    controlsCap.dampingFactor = 0.05;
    controlsCap.autoRotate = true;
    controlsCap.autoRotateSpeed = 0.3; // Slower rotation
    
    // Capture Helpers
    sceneCap.add(new THREE.GridHelper(40, 40, 0x333333, 0x222222));
    const axesCap = new THREE.AxesHelper(2);
    axesCap.position.y = 0.01; // Prevent Z-fighting with grid
    sceneCap.add(axesCap);
    
    // Standard Lighting (Capture)
    const lightCap = new THREE.DirectionalLight(0xffffff, 1.5);
    lightCap.position.set(10, 20, 10);
    sceneCap.add(lightCap);
    
    // Fill Light from opposite direction
    const fillLightCap = new THREE.DirectionalLight(0x90b0d0, 1.2);
    fillLightCap.position.set(-10, 0, -10);
    sceneCap.add(fillLightCap);
    
    // Hemisphere Light for excellent ambient depth
    const hemiLightCap = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    sceneCap.add(hemiLightCap);
    sceneCap.add(new THREE.AmbientLight(0x808080));
    
    // Sync Logic utilizing native events to fix jitter & damping issues
    let isSyncing = false;
    controlsMA2.addEventListener('change', () => {
        if (visualizerMode !== 'split' || isSyncing) return;
        isSyncing = true;
        cameraCap.position.copy(cameraMA2.position);
        cameraCap.quaternion.copy(cameraMA2.quaternion);
        controlsCap.target.copy(controlsMA2.target);
        controlsCap.update();
        isSyncing = false;
    });
    
    controlsCap.addEventListener('change', () => {
        if (visualizerMode !== 'split' || isSyncing) return;
        isSyncing = true;
        cameraMA2.position.copy(cameraCap.position);
        cameraMA2.quaternion.copy(cameraCap.quaternion);
        controlsMA2.target.copy(controlsCap.target);
        controlsMA2.update();
        isSyncing = false;
    });
    
    // Idle Timer (Smooth camera reset after 5s)
    let idleTimer = null;
    const defaultCameraPos = new THREE.Vector3(0, 5, 15);
    const defaultTarget = new THREE.Vector3(0, 0, 0);
    const defaultSpherical = new THREE.Spherical().setFromVector3(defaultCameraPos.clone().sub(defaultTarget));
    
    window._xyzIdleResetState = {
        isResetting: false,
        defaultTarget: defaultTarget,
        defaultSpherical: defaultSpherical
    };

    window._isXyzMouseDown = false;
    
    const setDown = () => { window._isXyzMouseDown = true; resetIdleTimer(); };
    const setUp = () => { window._isXyzMouseDown = false; resetIdleTimer(); };

    // Use capture phase (true) and pointer events to ensure OrbitControls doesn't consume the event before we see it
    window.addEventListener('pointerdown', setDown, true);
    window.addEventListener('pointerup', setUp, true);
    window.addEventListener('mousedown', setDown, true);
    window.addEventListener('mouseup', setUp, true);
    window.addEventListener('mouseleave', setUp, true);
    window.addEventListener('touchstart', setDown, true);
    window.addEventListener('touchend', setUp, true);

    function resetCamera() {
        if (window._isXyzMouseDown) return;
        if ((controlsMA2 || controlsCap) && is3DActive) {
            window._xyzIdleResetState.isResetting = true;
        }
    }
    function resetIdleTimer() {
        if (window._xyzIdleResetState.isResetting) {
            window._xyzIdleResetState.isResetting = false;
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(resetCamera, 5000);
    }
    
    // Bind interaction events to document body for broader coverage
    document.body.addEventListener('pointermove', resetIdleTimer, true);
    document.body.addEventListener('mousemove', resetIdleTimer, true);
    document.body.addEventListener('wheel', resetIdleTimer, true);
    document.body.addEventListener('touchmove', resetIdleTimer, true);
    
    resetIdleTimer();

    animate3D();
}

// Visual Cloner color palette
function getFixtureColor(fixture) {
    if (!fixture) return 0x555555;
    const typeStr = (fixture.fixture_type || '').toLowerCase();
    const nameStr = (fixture.name || '').toLowerCase();
    const layerStr = (fixture.layer || '').toLowerCase();
    const combined = typeStr + " " + nameStr + " " + layerStr;
    
    // Mandatory type colors
    if (/blinder|minibrute|\bbrute\d*\b|molefay/.test(combined)) {
        return 0xff7300; // Deep Orange
    }
    if (/fresnel/.test(combined)) {
        return 0xffe082; // Soft Yellow
    }
    if (/beam|\bspot\d*\b|sharpy|llp400|mythos/.test(combined)) {
        return 0x99ff99;
    }
    if (/parled|b eye|b-eye|trfa64/.test(combined)) {
        return 0x99ffff;
    }
    if (/wallwasher|\bww\d*\b|led bar|ledbar|led-bar|\bbar\d*\b|batten|pixel tube|pixeltube|ax1|colorado|strip|cyc|stick|fusion|blade|pixelline|chorus|colorband/.test(combined)) {
        return 0xcc99ff;
    }
    if (/stormy|strobe|jdc|colorstrike|\bstr\d*\b/.test(combined)) {
        return 0xff9999;
    }
    
    // Fallback to ID-based palette
    const fid = parseInt(fixture.fixture_id); 
    if (isNaN(fid)) return 0x555555;
    const p = [0x555555, 0x2979ff, 0x00e676, 0xff5252, 0x00bcd4, 0xe040fb, 0x1de9b6, 0xffc400, 0xf50057, 0x00b0ff, 0xc6ff00];
    return p[Math.floor(fid / 100) % p.length];
}

let ma2Container = null;
let capContainer = null;

let geoCache = null;
let showLabels = false;

function toggleLabels() {
    showLabels = !showLabels;
    const btn = document.getElementById('btn-toggle-labels');
    if (btn) btn.classList.toggle('active', showLabels);
    update3DView();
}

const spriteCache = {};
const materialCache = {};

function createLabelSprite(text) {
    if (!text) return null;
    if (spriteCache[text]) {
        return new THREE.Sprite(spriteCache[text]);
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Background pill
    ctx.fillStyle = 'rgba(20, 20, 20, 0.7)';
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(0, 0, 128, 64, 16);
        ctx.fill();
    } else {
        ctx.fillRect(0, 0, 128, 64);
    }
    
    // Text
    ctx.font = 'bold 28px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 64, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    spriteCache[text] = material;
    
    return new THREE.Sprite(material);
}

function getBoxGeometryForFixture(fixture) {
    if (!geoCache) {
        geoCache = {
            ledbar: new THREE.BoxGeometry(1.0, 0.1, 0.1),
            stormy: new THREE.BoxGeometry(0.5, 0.3, 0.2),
            blinder: new THREE.BoxGeometry(0.6, 0.6, 0.2),
            par: new THREE.BoxGeometry(0.4, 0.4, 0.4),
            default: new THREE.BoxGeometry(0.4, 0.4, 0.6)
        };
    }
    
    if (!fixture) return geoCache.default;
    
    const typeStr = (fixture.fixture_type || '').toLowerCase();
    const nameStr = (fixture.name || '').toLowerCase();
    const combined = typeStr + " " + nameStr;
    
    if (combined.includes('bar') || combined.includes('batten') || combined.includes('colorado') || combined.includes('x4 bar') || combined.includes('colorband') || combined.includes('chorus') || combined.includes('pixelline') || combined.includes('blade') || combined.includes('fusion') || combined.includes('stick') || combined.includes('strip') || combined.includes('cyc') || combined.includes('wallwasher') || combined.includes('ww') || combined.includes('pixeltube')) {
        return geoCache.ledbar;
    }
    if (combined.includes('strobe') || combined.includes('stormy') || combined.includes('jdc') || combined.includes('colorstrike')) {
        return geoCache.stormy;
    }
    if (combined.includes('blinder') || combined.includes('brute') || combined.includes('molefay')) {
        return geoCache.blinder;
    }
    if (combined.includes('par')) {
        return geoCache.par;
    }
    
    return geoCache.default;
}

function update3DView() {
    if (!is3DInitialized || !is3DActive) return;
    
    // Dispose old meshes safely to prevent massive memory leaks
    const disposeNode = (node) => {
        // Do NOT dispose node.geometry because they are shared from geoCache!
        
        // Dispose materials only if they are not cached (Sprites use cached materials)
        // Note: MeshLambertMaterials are now cached globally in materialCache, so we don't dispose them per-node anymore!
        if (node.material && node.type !== 'Sprite' && node.type !== 'Mesh') {
            if (Array.isArray(node.material)) {
                node.material.forEach(m => {
                    if (m.map) m.map.dispose();
                    m.dispose();
                });
            } else {
                if (node.material.map) node.material.map.dispose();
                node.material.dispose();
            }
        }
    };
    
    if (ma2Container) {
        ma2Container.traverse(disposeNode);
        sceneMA2.remove(ma2Container);
    }
    if (capContainer) {
        capContainer.traverse(disposeNode);
        sceneCap.remove(capContainer);
    }
    
    // BOTH MA2 and Capture XMLs are natively Z-up (exported for MA2).
    // We create containers and rotate them -90 deg on X so their local Z points UP in Three.js (which is Y-up).
    ma2Container = new THREE.Object3D();
    ma2Container.rotation.x = -Math.PI / 2;
    sceneMA2.add(ma2Container);
    
    capContainer = new THREE.Object3D();
    capContainer.rotation.x = -Math.PI / 2;
    sceneCap.add(capContainer);
    
    // Plot MA2 Targets
    state.ma2Fixtures.forEach(mf => {
        const boxGeo = getBoxGeometryForFixture(mf);
        
        const color = getFixtureColor(mf);
        
        let mat = materialCache[color];
        if (!mat) {
            mat = new THREE.MeshLambertMaterial({ color: color });
            materialCache[color] = mat;
        }
        
        // Single material for all 6 faces
        const mesh = new THREE.Mesh(boxGeo, mat);
        
        if (showLabels && mf.fixture_id) {
            const sprite = createLabelSprite(mf.fixture_id);
            if (sprite) {
                sprite.scale.set(0.6, 0.3, 1); // Reduced overall label size
                sprite.position.set(0, 0.5, 0); // Float slightly closer to the fixture
                mesh.add(sprite);
            }
        }
        
        // Cache boxGeo for wireframe later
        mesh.userData.boxGeo = boxGeo;
        
        let x = 0, y = 0, z = 0;
        let rx = 0, ry = 0, rz = 0;
        
        if (mf.has_position) {
            x = parseFloat(mf.pos_x) || 0;
            y = parseFloat(mf.pos_y) || 0;
            z = parseFloat(mf.pos_z) || 0;
            rx = parseFloat(mf.rot_x) || 0;
            ry = parseFloat(mf.rot_y) || 0;
            rz = parseFloat(mf.rot_z) || 0;
        }
        
        mesh.position.set(x, y, z);
        
        // MA2 standard rotation (Pan=Z, Tilt=X, Roll=Y) usually follows ZYX order
        mesh.rotation.set(
            THREE.MathUtils.degToRad(rx),
            THREE.MathUtils.degToRad(ry),
            THREE.MathUtils.degToRad(rz),
            'ZYX'
        );
        


        ma2Container.add(mesh);
    });
    
    // Plot Capture Targets
    state.captureFixtures.forEach(cf => {
        const boxGeo = getBoxGeometryForFixture(cf);
        
        const color = getFixtureColor(cf);
        
        let mat = materialCache[color];
        if (!mat) {
            mat = new THREE.MeshLambertMaterial({ color: color });
            materialCache[color] = mat;
        }
        
        // Single material for all 6 faces
        const mesh = new THREE.Mesh(boxGeo, mat);
        
        if (showLabels && (cf.fixture_id || cf.unit)) {
            const sprite = createLabelSprite(cf.fixture_id || cf.unit);
            if (sprite) {
                sprite.scale.set(0.6, 0.3, 1); // Reduced overall label size
                sprite.position.set(0, 0.5, 0); 
                mesh.add(sprite);
            }
        }
        
        // Cache boxGeo for wireframe later
        mesh.userData.boxGeo = boxGeo;
        
        let x = parseFloat(cf.pos_x) || 0;
        let y = parseFloat(cf.pos_y) || 0;
        let z = parseFloat(cf.pos_z) || 0;
        let rx = parseFloat(cf.rot_x) || 0;
        let ry = parseFloat(cf.rot_y) || 0;
        let rz = parseFloat(cf.rot_z) || 0;
        
        mesh.position.set(x, y, z);
        
        // Find mapping to check if flip Z is enabled
        const mappedMa2Id = Object.keys(state.mappings).find(ma2Id => {
            const m = state.mappings[ma2Id];
            return m && m.fixture_id === cf.fixture_id && m.dmx_address === cf.dmx_address;
        });
        
        // If flipped, add 180 to Z rotation (Pan) BEFORE setting the Euler rotation
        if (mappedMa2Id && state.flipZ[mappedMa2Id]) {
            rz += 180;
        }
        
        mesh.rotation.set(
            THREE.MathUtils.degToRad(rx),
            THREE.MathUtils.degToRad(ry),
            THREE.MathUtils.degToRad(rz),
            'ZYX'
        );
        


        
        capContainer.add(mesh);
    });
}

function animate3D() {
    if (!is3DActive) return;
    animationFrameId = requestAnimationFrame(animate3D);
    
    // Handle smooth reset lerping for Pan and Zoom
    if (window._xyzIdleResetState && window._xyzIdleResetState.isResetting) {
        const state = window._xyzIdleResetState;
        const applyLerp = (camera, controls) => {
            controls.target.lerp(state.defaultTarget, 0.05);
            const offset = camera.position.clone().sub(controls.target);
            const currentSpherical = new THREE.Spherical().setFromVector3(offset);
            
            currentSpherical.radius += (state.defaultSpherical.radius - currentSpherical.radius) * 0.05;
            currentSpherical.phi += (state.defaultSpherical.phi - currentSpherical.phi) * 0.05;
            // Leave currentSpherical.theta (rotation) alone
            
            offset.setFromSpherical(currentSpherical);
            camera.position.copy(controls.target).add(offset);
            
            if (Math.abs(currentSpherical.radius - state.defaultSpherical.radius) < 0.01 && 
                Math.abs(currentSpherical.phi - state.defaultSpherical.phi) < 0.01 &&
                controls.target.distanceTo(state.defaultTarget) < 0.01) {
                
                controls.target.copy(state.defaultTarget);
                currentSpherical.radius = state.defaultSpherical.radius;
                currentSpherical.phi = state.defaultSpherical.phi;
                offset.setFromSpherical(currentSpherical);
                camera.position.copy(controls.target).add(offset);
                return true; // Reached destination
            }
            return false;
        };
        
        let doneMA2 = true;
        let doneCap = true;
        if (visualizerMode === 'split' || visualizerMode === 'ma2') doneMA2 = applyLerp(cameraMA2, controlsMA2);
        if (visualizerMode === 'split' || visualizerMode === 'capture') doneCap = applyLerp(cameraCap, controlsCap);
        
        if (doneMA2 && doneCap) {
            state.isResetting = false;
        }
    }
    
    // MA2 Viewport
    if (visualizerMode === 'split' || visualizerMode === 'ma2') {
        if (elCanvasMA2 && elCanvasMA2.clientWidth > 1) {
            const wMA2 = elCanvasMA2.clientWidth;
            const hMA2 = elCanvasMA2.clientHeight;
            const sizeMA2 = new THREE.Vector2();
            rendererMA2.getSize(sizeMA2);
            
            if (sizeMA2.width !== wMA2 || sizeMA2.height !== hMA2) {
                cameraMA2.aspect = wMA2 / hMA2;
                cameraMA2.updateProjectionMatrix();
                rendererMA2.setSize(wMA2, hMA2, true);
            }
        }
        
        controlsMA2.autoRotate = !window._isXyzMouseDown; // Respect mouse state
        controlsMA2.update();
        rendererMA2.render(sceneMA2, cameraMA2);
    }
    
    // Capture Viewport
    if (visualizerMode === 'split' || visualizerMode === 'capture') {
        if (elCanvasCap && elCanvasCap.clientWidth > 1) {
            const wCap = elCanvasCap.clientWidth;
            const hCap = elCanvasCap.clientHeight;
            const sizeCap = new THREE.Vector2();
            rendererCap.getSize(sizeCap);
            
            if (sizeCap.width !== wCap || sizeCap.height !== hCap) {
                cameraCap.aspect = wCap / hCap;
                cameraCap.updateProjectionMatrix();
                rendererCap.setSize(wCap, hCap, true);
            }
        }
        
        // Prevent 2x rotation speed feedback loop in split mode
        if (visualizerMode === 'split') {
            controlsCap.autoRotate = false;
        } else {
            controlsCap.autoRotate = !window._isXyzMouseDown;
        }
        
        controlsCap.update();
        rendererCap.render(sceneCap, cameraCap);
    }
}
