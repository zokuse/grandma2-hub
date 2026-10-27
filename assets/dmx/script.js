let pyBridge = null;
let parsedUniverses = {}; // Structure: { 1: [fixtures], 2: [fixtures] }
let currentUniverse = 1;
const MAX_CHANNELS = 512;
let dmxDictionary = {};
let uniqueFixtureTypes = {};

function escXML(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

document.addEventListener("DOMContentLoaded", function() {
    initUniverseSelector();
    
let checkInterval;
function initBridge() {
    if (typeof qt !== 'undefined' && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            window.pyBridge = channel.objects.backend;
            pyBridge = window.pyBridge;
            if (pyBridge.progress_update) {
                pyBridge.progress_update.connect(showLoading);
            }
            if (pyBridge.patch_pulled) {
                pyBridge.patch_pulled.connect(function(patchResStr) {
                    hideLoading();
                    try {
                        let response = JSON.parse(patchResStr);
                        if (response.success) {
                            parsePatchXML(response.data);
                            showToast(`Patch pulled successfully!`, "success");
                        } else {
                            if (response.error !== "Cancelled") showToast(response.error, "error");
                        }
                    } catch (e) {
                        showToast("Error parsing patch response", "error");
                    }
                });
            }
            if (pyBridge.get_local_ips) {
                pyBridge.get_local_ips(function(res) {
                    try {
                        let ips = JSON.parse(res);
                        populateLiveAdapters(ips);
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
            if (pyBridge.get_dmx_dict) {
                pyBridge.get_dmx_dict(function(res) {
                    try {
                        if (res) dmxDictionary = JSON.parse(res);
                    } catch(e) {}
                });
            }
        });
        clearInterval(checkInterval);
    }
}
checkInterval = setInterval(initBridge, 100);
initBridge();
    
    // Tooltip logic
    const tooltip = document.getElementById('fixture-tooltip');
    document.addEventListener('mousemove', (e) => {
        if(tooltip.classList.contains('visible')) {
            let x = e.clientX + 15;
            let y = e.clientY + 15;
            const bounds = tooltip.getBoundingClientRect();
            if (x + bounds.width > window.innerWidth) x = e.clientX - bounds.width - 15;
            if (y + bounds.height > window.innerHeight) y = e.clientY - bounds.height - 15;
            tooltip.style.left = x + 'px';
            tooltip.style.top = y + 'px';
        }
    });
});

let activeUniversesList = [1];
let showEmptyUniverses = false;

function initUniverseSelector() {
    const list = document.getElementById('universe-sidebar-list');
    const statsStrip = document.getElementById('universe-stats-strip');
    if (!list || !statsStrip) return;
    
    // Compute total stats
    let populatedCount = 0;
    let totalFixtures = 0;
    let totalChannels = 0;
    let maxUniverseNum = 1;
    
    if (Object.keys(parsedUniverses).length > 0) {
        maxUniverseNum = Math.max(...Object.keys(parsedUniverses).map(Number));
        for (let u in parsedUniverses) {
            let fixturesInUni = parsedUniverses[u];
            if (fixturesInUni && fixturesInUni.length > 0) {
                populatedCount++;
                totalFixtures += fixturesInUni.length;
                totalChannels += fixturesInUni.reduce((sum, f) => sum + (f.footprint || 1), 0);
            }
        }
    }
    
    liveSeen.forEach(u => { if (u > maxUniverseNum) maxUniverseNum = u; });
    
    statsStrip.style.display = 'flex';
    statsStrip.innerHTML = `
        <div class="universe-stat">
            <span class="universe-stat-val">${populatedCount}</span>
            <span class="universe-stat-label">Populated</span>
        </div>
        <div class="universe-stat">
            <span class="universe-stat-val">${totalFixtures}</span>
            <span class="universe-stat-label">Fixtures</span>
        </div>
        <div class="universe-stat">
            <span class="universe-stat-val">${totalChannels}</span>
            <span class="universe-stat-label">Channels</span>
        </div>
    `;

    list.innerHTML = '';
    
    let emptyHiddenCount = 0;
    
    // If we have populated data, maxUniverseNum dictates the range.
    for (let i = 1; i <= Math.max(1, maxUniverseNum); i++) {
        let fixturesInUni = parsedUniverses[i] || [];
        let count = fixturesInUni.length;
        let chCount = fixturesInUni.reduce((sum, f) => sum + (f.footprint || 1), 0);
        let occupancyPercent = Math.min(100, (chCount / 512) * 100);
        
        let isEmpty = (count === 0);
        
        // Hide empty universes unless toggled on, or if it's the currently selected one
        if (isEmpty && !showEmptyUniverses && i !== currentUniverse && maxUniverseNum > 1 && !liveSeen.has(i)) {
            emptyHiddenCount++;
            continue;
        }

        const btn = document.createElement('div');
        btn.className = `universe-btn ${i === currentUniverse ? 'active' : ''}`;
        btn.id = `uni-btn-${i}`;
        btn.onclick = () => changeUniverse(i);
        
        let warningClass = occupancyPercent >= 50 ? 'warning' : '';
        
        btn.innerHTML = `
            <div class="universe-btn-top">
                <div class="universe-btn-label">
                    <span class="universe-chip">${i}</span>
                    <span>Universe ${i}</span>${liveSeen.has(i) ? '<span class="live-dot" title="Receiving Art-Net"></span>' : ''}
                </div>
                <div class="universe-btn-stats">${count} Fix • ${Math.round(occupancyPercent)}%</div>
            </div>
            <div class="universe-loading-track">
                <div class="universe-loading-fill ${warningClass}" style="width: ${occupancyPercent}%"></div>
            </div>
        `;
        list.appendChild(btn);
    }
    
    // Append the toggle button if there are hidden empty universes
    if (emptyHiddenCount > 0) {
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'empty-universe-toggle';
        toggleBtn.textContent = `Show ${emptyHiddenCount} empty universes`;
        toggleBtn.onclick = () => {
            showEmptyUniverses = true;
            initUniverseSelector();
        };
        list.appendChild(toggleBtn);
    } else if (showEmptyUniverses && maxUniverseNum > 1) {
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'empty-universe-toggle';
        toggleBtn.textContent = `Hide empty universes`;
        toggleBtn.onclick = () => {
            showEmptyUniverses = false;
            initUniverseSelector();
        };
        list.appendChild(toggleBtn);
    }
}

function changeUniverse(num) {
    currentUniverse = num;
    initUniverseSelector(); // Re-render to update 'active' class and empty state logic
    renderGrid();
    renderLegend();
    renderPanels();
    updateLiveUI();
}

// Modal and Loading Functions
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}
function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}
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

function clearPatchList() {
    parsedUniverses = {};
    resetMoves();
    renderPanels();
    activeUniversesList = [1];
    showEmptyUniverses = false;
    initUniverseSelector();
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('dmx-grid-container').style.display = 'none';
    
    const legendContainer = document.getElementById('fixture-legend-container');
    if (legendContainer) legendContainer.style.display = 'none';
    
    showToast("DMX View cleared.", "success");
}

function importPatchXMLNative() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    pyBridge.import_patch(function(resStr) {
        let response = JSON.parse(resStr);
        if (!response.success) { if (response.error !== "Cancelled") showToast(response.error, "error"); return; }
        parsePatchXML(response.data);
    });
}

function pullFromGrandMA2() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    if (pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            if (credsStr) {
                try {
                    const creds = JSON.parse(credsStr);
                    if (creds.ip && creds.ip.trim() !== '') {
                        showLoading("Connecting to MA2...");
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
    let creds = {
        ip: document.getElementById('login-ip').value.split(' ')[0] || "127.0.0.1",
        user: document.getElementById('login-user').value || "administrator",
        password: document.getElementById('login-pass').value || "admin"
    };
    let loginStr = JSON.stringify(creds);
    
    if (pendingLoginAction) {
        const action = pendingLoginAction;
        pendingLoginAction = null;
        action(loginStr);
        return;
    }
    showLoading("Connecting to MA2...");
    pyBridge.pull_patch(loginStr);
}

function parsePatchXML(xmlString, keepMoves = false) {
    window._currentPatchXML = xmlString;
    try {
        const parser = new DOMParser(); 
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        
        parsedUniverses = {};
        
        // Find all fixtures across all layers
        const fixturesNodes = xmlDoc.querySelectorAll('Fixture');
        
        let tempFixtures = [];

        fixturesNodes.forEach(n => {
            let rawFid = parseInt(n.getAttribute('fixture_id') || "0");
            let rawCid = parseInt(n.getAttribute('channel_id') || "0");
            
            let displayId = "";
            if (rawFid !== 0) displayId = "Fix " + rawFid;
            else if (rawCid !== 0) displayId = "Ch " + rawCid;
            else return; 
            
            let name = n.getAttribute('name') || "Unknown";
            let type = "Standard";
            let mode = "-";
            const typeNode = n.querySelector('FixtureType');
            if (typeNode) {
                type = typeNode.getAttribute('name') || type;
                // Strip leading MA2 fixture type index (e.g. "11 Sharpy" -> "Sharpy")
                if (/^\d+\s+(.*)/.test(type)) type = type.match(/^\d+\s+(.*)/)[1];
                mode = typeNode.getAttribute('mode') || "-";
            }
            
            let layer = "";
            let p = n.parentNode;
            while (p && p !== xmlDoc) {
                if (p.nodeName === 'Layer' || p.localName === 'Layer') {
                    layer = p.getAttribute('name') || "";
                    break;
                }
                p = p.parentNode;
            }

            const addressNode = n.querySelector('SubFixture Patch Address');
            if (addressNode) {
                let absoluteAddr = parseInt(addressNode.textContent.trim());
                if (!isNaN(absoluteAddr) && absoluteAddr > 0) {
                    let universe = Math.floor((absoluteAddr - 1) / 512) + 1;
                    let relativeAddr = ((absoluteAddr - 1) % 512) + 1;
                    
                    let tagsFootprint = n.querySelectorAll('Channel').length;
                    
                    tempFixtures.push({
                        id: displayId,
                        fixtureNum: rawFid, // 0 = channel-only entry (cannot be re-addressed from here)
                        name: name,
                        type: type,
                        mode: mode,
                        layer: layer,
                        universe: universe,
                        address: relativeAddr,
                        absolute: absoluteAddr,
                        footprint: 1, // Will be calculated in the next pass
                        tagsFootprint: tagsFootprint
                    });
                }
            }
        });

        // Group by Universe and Calculate Smart Footprint
        tempFixtures.sort((a, b) => a.absolute - b.absolute);
        
        uniqueFixtureTypes = {}; // Reset

        // --- PRE-COMPUTE UNIFIED TIER 3 ESTIMATION ---
        let typeGaps = {}; // { typeName: { gaps: [], maxTags: 0 } }
        for (let i = 0; i < tempFixtures.length; i++) {
            let f = tempFixtures[i];
            if (!typeGaps[f.type]) typeGaps[f.type] = { gaps: [], maxTags: 0 };
            
            typeGaps[f.type].maxTags = Math.max(typeGaps[f.type].maxTags, f.tagsFootprint || 1);
            
            if (i < tempFixtures.length - 1) {
                let nextF = tempFixtures[i+1];
                let rawGap = nextF.absolute - f.absolute;
                if (rawGap > 0 && rawGap <= 60) {
                    typeGaps[f.type].gaps.push(rawGap);
                }
            }
        }
        
        let typeUnifiedEstimates = {};
        for (let type in typeGaps) {
            let data = typeGaps[type];
            let minGap = data.gaps.length > 0 ? Math.min(...data.gaps) : 1;
            typeUnifiedEstimates[type] = Math.max(minGap, data.maxTags);
        }

        // --- APPLY FOOTPRINTS ---
        for (let i = 0; i < tempFixtures.length; i++) {
            let f = tempFixtures[i];
            
            // 4-Tier Smart Footprint Logic:
            // Tier 1 (Manual Override): User-saved override in dmxDictionary takes highest priority.
            // Tier 2 (Regex): Extract footprint explicitly stated in fixture type names (e.g. "16ch" -> 16).
            // Tier 3 (Gap/Tags Unified Estimation): Infers footprint from the smallest DMX gap between consecutive fixtures of the same type, reconciled against the max XML <Channel> tag count.
            // Tier 4 (Dimmer Special Case): Hardcoded 1-channel footprint for standard "dimmer 00" types.
            f.uncertain = false;
            if (dmxDictionary[f.type]) {
                // Tier 1: Manual Dictionary Override
                f.footprint = parseInt(dmxDictionary[f.type]);
            } else {
                // Tier 2: Regex Name Extraction
                let regexMatch = f.type.match(/(\d+)\s*(?:ch|channel)s?/i);
                if (regexMatch && parseInt(regexMatch[1]) > 0) {
                    f.footprint = parseInt(regexMatch[1]);
                } else {
                    // Tier 3: Unified Type-Based Estimation
                    if (f.type.toLowerCase().includes('dimmer 00')) {
                        f.footprint = 1;
                    } else {
                        f.footprint = typeUnifiedEstimates[f.type];
                        // Uncertain when there is no gap sample, or the gaps and XML tags disagree
                        let tg = typeGaps[f.type];
                        f.uncertain = tg.gaps.length === 0 || Math.min(...tg.gaps) !== tg.maxTags;
                    }
                }
            }

            // Register to uniqueFixtureTypes for the sidebar
            if (!uniqueFixtureTypes[f.type]) {
                uniqueFixtureTypes[f.type] = {
                    type: f.type,
                    footprint: f.footprint
                };
            }
            
            // Handle cross-universe fixtures
            f.baseFootprint = f.footprint; // un-clipped size, used when the fixture is moved
            f.clipped = f.address + f.footprint - 1 > MAX_CHANNELS;
            if (f.clipped) {
                f.footprint = MAX_CHANNELS - f.address + 1;
            }
            
            if (!parsedUniverses[f.universe]) {
                parsedUniverses[f.universe] = [];
            }
            parsedUniverses[f.universe].push(f);
        }

        // Re-apply moves the user already made (sent or staged) on top of the fresh XML
        if (keepMoves) {
            sentMoves.forEach((pos, id) => { let f = findFixtureById(id); if (f) moveFixture(f, pos.universe, pos.address); });
            pendingMoves.forEach((m, id) => { let f = findFixtureById(id); if (f) moveFixture(f, m.to.universe, m.to.address); });
        } else {
            resetMoves();
        }
        
        let populatedUniverses = Object.keys(parsedUniverses).map(Number).sort((a, b) => a - b);
        activeUniversesList = populatedUniverses.length > 0 ? populatedUniverses : [1];
        initUniverseSelector();
        
        // Auto-select first populated universe within limits
        for (let i of activeUniversesList) {
            let badge = document.getElementById(`uni-badge-${i}`);
            if (badge) {
                let count = 0;
                let chCount = 0;
                if (parsedUniverses[i]) {
                    count = parsedUniverses[i].length;
                    chCount = parsedUniverses[i].reduce((sum, f) => sum + (f.footprint || 1), 0);
                }
                badge.textContent = `${count} Fix • ${chCount} Ch`;
            }
        }
        
        let targetUni = populatedUniverses[0];
        
        if (targetUni) {
            changeUniverse(targetUni);
        } else {
            renderGrid();
        }
        
    } catch(err) { 
        showToast("XML Parse Error", "error"); 
        console.error(err);
    }
}

let cellEls = [];   // channel number -> .channel-cell element (current universe)
let levelEls = [];  // channel number -> .channel-level element (live bar)
let conflictState = { cells: {}, list: [] };

function renderGrid() {
    const emptyState = document.getElementById('empty-state');
    const container = document.getElementById('dmx-grid-container');
    
    if (Object.keys(parsedUniverses).length === 0 && !liveActive) {
        emptyState.style.display = 'flex';
        container.style.display = 'none';
        return;
    }
    
    emptyState.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = '';
    
    const grid = document.createElement('div');
    grid.className = 'dmx-grid';
    
    let fixturesInUniverse = parsedUniverses[currentUniverse] || [];
    conflictState = computeConflicts();
    const conflictSet = conflictState.cells[currentUniverse] || new Set();
    
    // Create map of cell index (1 to 512) to fixture data (heads win over bodies on overlap)
    let cellMap = {};
    fixturesInUniverse.forEach(f => {
        for (let i = 1; i < f.footprint; i++) {
            let addr = f.address + i;
            if (addr <= MAX_CHANNELS && !cellMap[addr]) {
                cellMap[addr] = { type: 'body', fixture: f };
            }
        }
    });
    fixturesInUniverse.forEach(f => {
        cellMap[f.address] = { type: 'head', fixture: f };
    });

    const tooltip = document.getElementById('fixture-tooltip');

    let blocks = [];
    let currentBlock = null;

    for (let i = 1; i <= MAX_CHANNELS; i++) {
        let mapping = cellMap[i];
        let isConflict = conflictSet.has(i);
        let key = (mapping ? mapping.fixture.id : '') + (isConflict ? '!' : '');
        let isRowStart = ((i - 1) % 32 === 0);
        
        if (!currentBlock || currentBlock.key !== key || isRowStart) {
            currentBlock = {
                key: key,
                fixtureId: mapping ? mapping.fixture.id : null,
                fixture: mapping ? mapping.fixture : null,
                conflict: isConflict,
                start: i,
                channels: [i]
            };
            blocks.push(currentBlock);
        } else {
            currentBlock.channels.push(i);
        }
    }

    cellEls = [];
    levelEls = [];
    lastLevels = [];

    blocks.forEach(block => {
        const blockEl = document.createElement('div');
        blockEl.className = 'fixture-block';
        blockEl.dataset.start = block.start;
        blockEl.dataset.count = block.channels.length;
        if (block.fixture) {
            blockEl.dataset.fid = block.fixture.id;
            blockEl.classList.add('is-patched');
            if (block.fixture.fixtureNum > 0) blockEl.classList.add('is-draggable');
            if (block.fixture.uncertain) blockEl.classList.add('is-uncertain');
            if (pendingMoves.has(block.fixture.id)) blockEl.classList.add('is-moved');
            if (dragState && dragState.active && dragState.f === block.fixture) blockEl.classList.add('drag-source');
        }
        if (block.conflict) blockEl.classList.add('is-conflict');
        
        blockEl.style.gridColumn = `span ${block.channels.length}`;
        
        let headerHtml = '';
        let colorHex = '#4CAF50';
        if (block.fixture) {
            colorHex = getFixtureColorHex(block.fixture);
            blockEl.style.backgroundColor = colorHex + '15'; // 15% opacity
            blockEl.style.setProperty('--fx-color', colorHex);
            headerHtml = `<div class="fixture-header" style="background-color: ${colorHex}40;">${escXML(block.fixture.name)}${block.fixture.uncertain ? ' ?' : ''}</div>`;
        }

        let channelsHtml = `<div class="channels-container">
            ${block.channels.map(ch => `
                <div class="channel-cell" data-ch="${ch}">
                    <div class="channel-number">${ch}</div>
                    <div class="channel-level"></div>
                    <div class="channel-line" style="${block.fixture ? `background-color: ${colorHex}99;` : ''}"></div>
                </div>
            `).join('')}
        </div>`;

        blockEl.innerHTML = channelsHtml + headerHtml;

        blockEl.querySelectorAll('.channel-cell').forEach(cell => {
            const ch = parseInt(cell.dataset.ch);
            cellEls[ch] = cell;
            levelEls[ch] = cell.querySelector('.channel-level');
        });

        if (block.fixture) {
            blockEl.addEventListener('pointerdown', (e) => onBlockPointerDown(e, block.fixture, block));

            blockEl.addEventListener('mouseenter', () => {
                if (dragState && dragState.active) return;
                let f = block.fixture;
                tooltip.innerHTML = `
                    <div class="tooltip-title">${escXML(f.id)} : ${escXML(f.name)}</div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Type:</span>
                        <span class="tooltip-value">${escXML(f.type)}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Mode:</span>
                        <span class="tooltip-value">${escXML(f.mode)}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Address:</span>
                        <span class="tooltip-value">${escXML(f.universe)}.${String(f.address).padStart(3, '0')}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Footprint:</span>
                        <span class="tooltip-value">${f.footprint} ch${f.uncertain ? ' (estimated)' : ''}</span>
                    </div>
                    ${liveActive ? `<div class="tooltip-row"><span class="tooltip-label">Live:</span><span class="tooltip-value" id="tip-live"></span></div>` : ''}
                `;
                tooltip.classList.add('visible');
                updateTooltipLive();
            });
            
            blockEl.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
        }

        grid.appendChild(blockEl);
    });

    grid.addEventListener('mouseover', (ev) => {
        const cell = ev.target.closest ? ev.target.closest('.channel-cell') : null;
        hoverCh = cell ? parseInt(cell.dataset.ch) : 0;
        updateTooltipLive();
    });

    container.appendChild(grid);
    refreshLiveCells(true);
}

function renderLegend() {
    const legendContainer = document.getElementById('fixture-legend-container');
    const legendList = document.getElementById('fixture-legend-list');
    
    let uniqueLayers = {};
    let currentFixtures = parsedUniverses[currentUniverse] || [];
    
    // Scope to current universe
    currentFixtures.forEach(f => {
        let layerName = f.layer || 'No Layer';
        if (!uniqueLayers[layerName]) {
            uniqueLayers[layerName] = { layer: layerName, color: getFixtureColorHex(f), fixtureTypes: {}, count: 0, channels: 0 };
        }
        uniqueLayers[layerName].fixtureTypes[f.type] = f.footprint;
        uniqueLayers[layerName].count++;
        uniqueLayers[layerName].channels += (f.footprint || 1);
    });

    legendList.innerHTML = '';
    let uniqueArr = Object.values(uniqueLayers);
    window.currentUniqueLayers = uniqueLayers; // Still expose for modal editor

    if (uniqueArr.length > 0) {
        legendContainer.style.display = 'block';
        uniqueArr.forEach(t => {
            let el = document.createElement('div');
            el.className = 'legend-item';
            let safeLayer = encodeURIComponent(t.layer);
            el.innerHTML = `
                <div class="legend-item-left">
                    <div class="color-swatch" style="background-color: ${t.color}"></div>
                    <div class="legend-name" title="Layer: ${escXML(t.layer)}">${escXML(t.layer)}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 11px; color: #888;">${t.count} Fix • ${t.channels} Ch</span>
                    <button class="dmx-btn-icon" onclick="openLayerEditor(decodeURIComponent('${safeLayer}'))">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                    </button>
                </div>
            `;
            legendList.appendChild(el);
        });
    } else {
        legendContainer.style.display = 'none';
    }
}

function saveFootprint(type, footprint) {
    if (!pyBridge) {
        showToast("Cannot save footprint: Bridge not connected", "error");
        return;
    }
    dmxDictionary[type] = footprint;
    if (pyBridge.save_dmx_dict) {
        pyBridge.save_dmx_dict(JSON.stringify(dmxDictionary));
        showToast("Footprint saved!", "success");
    }
    
    // Reparse the XML to apply changes cleanly if we still have it in memory?
    // We can just manually override the footprints in `parsedUniverses` and re-render.
    let changed = false;
    for (let uni in parsedUniverses) {
        parsedUniverses[uni].forEach(f => {
            if (f.type === type) {
                f.baseFootprint = footprint;
                f.uncertain = false;
                f.footprint = Math.min(footprint, MAX_CHANNELS - f.address + 1);
                changed = true;
                
                // Constrain bounds
                if (f.address + f.footprint - 1 > MAX_CHANNELS) {
                    f.footprint = MAX_CHANNELS - f.address + 1;
                }
            }
        });
    }
    
    if (changed) {
        uniqueFixtureTypes[type].footprint = footprint;
        renderGrid();
    }
}

function getFixtureColorHex(fixture) {
    if (!fixture) return '#555555';
    const typeStr = (fixture.type || '').toLowerCase();
    const nameStr = (fixture.name || '').toLowerCase();
    const layerStr = (fixture.layer || '').toLowerCase();
    const combined = typeStr + " " + nameStr + " " + layerStr;
    
    if (/blinder|minibrute|\bbrute\d*\b|molefay/.test(combined)) {
        return '#ff7300';
    }
    if (/fresnel/.test(combined)) {
        return '#ffe082';
    }
    if (/beam|\bspot\d*\b|sharpy|llp400|mythos/.test(combined)) {
        return '#99ff99';
    }
    if (/parled|b eye|b-eye|trfa64/.test(combined)) {
        return '#99ffff';
    }
    if (/wallwasher|\bww\d*\b|led bar|ledbar|led-bar|\bbar\d*\b|batten|pixel tube|pixeltube|ax1|colorado|strip|cyc|stick|fusion|blade|pixelline|chorus|colorband/.test(combined)) {
        return '#cc99ff';
    }
    if (/stormy|strobe|jdc|colorstrike|\bstr\d*\b/.test(combined)) {
        return '#ff9999';
    }
    
    let fid = parseInt(fixture.id.replace(/[^0-9]/g, ''));
    if (isNaN(fid)) return '#555555';
    const p = ['#555555', '#2979ff', '#00e676', '#ff5252', '#00bcd4', '#e040fb', '#1de9b6', '#ffc400', '#f50057', '#00b0ff', '#c6ff00'];
    return p[Math.floor(fid / 100) % p.length];
}

function openLayerEditor(layerName) {
    let layerData = window.currentUniqueLayers[layerName];
    if (!layerData) return;
    
    document.getElementById('layer-editor-title').textContent = `Footprints: ${layerName}`;
    let listContainer = document.getElementById('layer-editor-list');
    listContainer.innerHTML = '';
    
    let types = Object.keys(layerData.fixtureTypes).sort();
    
    if (types.length === 0) {
        listContainer.innerHTML = '<p style="color:#aaa; font-size:13px;">No fixtures found in this layer.</p>';
    } else {
        types.forEach(type => {
            let footprint = layerData.fixtureTypes[type];
            let row = document.createElement('div');
            row.className = 'layer-editor-row';
            
            // Safe type string for data attribute and label
            let safeType = escXML(type);
            
            row.innerHTML = `
                <div class="layer-editor-label" title="${safeType}">${safeType}</div>
                <input type="number" class="layer-editor-input" data-type="${safeType}" value="${footprint}" min="1" max="512">
            `;
            listContainer.appendChild(row);
        });
    }
    
    openModal('layer-editor-modal');
}

function submitLayerFootprints() {
    let inputs = document.querySelectorAll('#layer-editor-list .layer-editor-input');
    let hasChanges = false;
    
    inputs.forEach(input => {
        let type = input.getAttribute('data-type');
        let newFootprint = parseInt(input.value);
        if (!isNaN(newFootprint) && newFootprint > 0 && newFootprint <= 512) {
            // Save to dictionary
            dmxDictionary[type] = newFootprint;
            hasChanges = true;
        }
    });
    
    if (hasChanges) {
        // Trigger save to backend
        pyBridge.save_dmx_dict(JSON.stringify(dmxDictionary));
        showToast("Footprints saved!", "success");
        // Re-render
        if (window._currentPatchXML) {
            parsePatchXML(window._currentPatchXML, true);
        }
    }
    
    closeModal('layer-editor-modal');
}


// ============================================================
// Re-addressing: staged moves, undo, send to MA2
// ============================================================
const pendingMoves = new Map(); // id -> { fixtureNum, from:{universe,address}, to:{universe,address} }
const sentMoves = new Map();    // id -> {universe,address} (already pushed to the console)
let moveHistory = [];           // [{ id, prev:{universe,address} }]
let pendingLoginAction = null;

function resetMoves() {
    pendingMoves.clear();
    sentMoves.clear();
    moveHistory = [];
}

function findFixtureById(id) {
    for (let u in parsedUniverses) {
        const f = parsedUniverses[u].find(x => x.id === id);
        if (f) return f;
    }
    return null;
}

function moveFixture(f, universe, address) {
    const list = parsedUniverses[f.universe];
    if (list) {
        const idx = list.indexOf(f);
        if (idx >= 0) list.splice(idx, 1);
    }
    const base = f.baseFootprint || f.footprint;
    f.universe = universe;
    f.address = address;
    f.absolute = (universe - 1) * MAX_CHANNELS + address;
    f.clipped = base > MAX_CHANNELS - address + 1;
    f.footprint = Math.max(1, Math.min(base, MAX_CHANNELS - address + 1));
    if (!parsedUniverses[universe]) parsedUniverses[universe] = [];
    parsedUniverses[universe].push(f);
}

function stageMove(f, universe, address) {
    if (f.universe === universe && f.address === address) return;
    const prev = { universe: f.universe, address: f.address };
    moveHistory.push({ id: f.id, prev: prev });
    const existing = pendingMoves.get(f.id);
    const from = existing ? existing.from : prev;
    moveFixture(f, universe, address);
    if (from.universe === universe && from.address === address) {
        pendingMoves.delete(f.id);
    } else {
        pendingMoves.set(f.id, { fixtureNum: f.fixtureNum, from: from, to: { universe: universe, address: address } });
    }
    refreshAll();
}

function undoMove() {
    const h = moveHistory.pop();
    if (!h) return;
    const f = findFixtureById(h.id);
    if (!f) return;
    moveFixture(f, h.prev.universe, h.prev.address);
    const ex = pendingMoves.get(h.id);
    if (ex) {
        if (ex.from.universe === h.prev.universe && ex.from.address === h.prev.address) pendingMoves.delete(h.id);
        else ex.to = { universe: h.prev.universe, address: h.prev.address };
    }
    refreshAll();
}

function revertMove(id) {
    const ex = pendingMoves.get(id);
    const f = findFixtureById(id);
    if (!ex || !f) return;
    moveFixture(f, ex.from.universe, ex.from.address);
    pendingMoves.delete(id);
    moveHistory = moveHistory.filter(h => h.id !== id);
    refreshAll();
}

function revertAllMoves() {
    Array.from(pendingMoves.keys()).forEach(id => {
        const ex = pendingMoves.get(id);
        const f = findFixtureById(id);
        if (ex && f) moveFixture(f, ex.from.universe, ex.from.address);
    });
    pendingMoves.clear();
    moveHistory = [];
    refreshAll();
}

function refreshAll() {
    initUniverseSelector();
    renderGrid();
    renderLegend();
    renderPanels();
}

function ensureCredentials(onReady) {
    if (!pyBridge) return showToast("Bridge not ready", "error");
    const askLogin = () => { pendingLoginAction = onReady; openModal('login-modal'); };
    if (pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            try {
                const c = JSON.parse(credsStr);
                if (c && c.ip && c.ip.trim() !== '') { onReady(credsStr); return; }
            } catch (e) {}
            askLogin();
        });
    } else {
        askLogin();
    }
}

function sendChangesToMA2() {
    if (pendingMoves.size === 0) return showToast("No pending address changes.", "info");
    const fmt = p => `${p.universe}.${String(p.address).padStart(3, '0')}`;
    document.getElementById('send-confirm-text').textContent = `${pendingMoves.size} fixture${pendingMoves.size > 1 ? 's' : ''} will be re-addressed:`;
    const list = document.getElementById('send-confirm-list');
    list.innerHTML = '';
    pendingMoves.forEach((m, id) => {
        const row = document.createElement('div');
        row.className = 'pending-item';
        row.textContent = `${id}   ${fmt(m.from)} \u2192 ${fmt(m.to)}`;
        list.appendChild(row);
    });
    openModal('send-confirm-modal');
}

function confirmSendChanges() {
    closeModal('send-confirm-modal');
    if (pendingMoves.size === 0) return;
    ensureCredentials(credsStr => {
        const changes = Array.from(pendingMoves.entries()).map(([id, m]) => ({
            id: id, fixtureNum: m.fixtureNum, universe: m.to.universe, address: m.to.address
        }));
        showLoading("Connecting to MA2...");
        pyBridge.apply_dmx_changes(credsStr, JSON.stringify(changes), resStr => {
            hideLoading();
            let res;
            try { res = JSON.parse(resStr); } catch (e) { return showToast("Invalid response from backend", "error"); }
            if (!res.success) return showToast(res.error, "error");
            const applied = res.data.applied || [];
            const failed = res.data.failed || [];
            const unconfirmed = res.data.unconfirmed || [];
            applied.forEach(id => {
                const m = pendingMoves.get(id);
                if (m) { sentMoves.set(id, m.to); pendingMoves.delete(id); }
            });
            moveHistory = moveHistory.filter(h => pendingMoves.has(h.id));
            refreshAll();
            if (unconfirmed.length > 0) {
                showToast(`${unconfirmed.length} fixture(s) got no reply from the console (${unconfirmed.join(', ')}). They stay pending; pull the patch to check whether they applied.`, "warning", 9000);
            } else if (failed.length > 0) {
                showToast(`${applied.length} sent, ${failed.length} failed (${failed[0].id}: ${failed[0].error})`, "warning", 6000);
            } else {
                showToast(`Re-addressed ${applied.length} fixture(s) on MA2!`, "success");
            }
        });
    });
}

// ============================================================
// Collision detection & warnings
// ============================================================
function computeConflicts() {
    const cells = {};
    const list = [];
    const pairMap = new Map();
    for (let u in parsedUniverses) {
        const occ = new Array(MAX_CHANNELS + 2).fill(null);
        const set = new Set();
        parsedUniverses[u].forEach(f => {
            for (let ch = f.address; ch < f.address + f.footprint && ch <= MAX_CHANNELS; ch++) {
                const o = occ[ch];
                if (o && o !== f) {
                    set.add(ch);
                    const key = u + '|' + o.id + '|' + f.id;
                    let p = pairMap.get(key);
                    if (!p) {
                        p = { universe: parseInt(u), a: o, b: f, start: ch, end: ch };
                        pairMap.set(key, p);
                        list.push(p);
                    } else {
                        p.end = ch;
                    }
                } else {
                    occ[ch] = f;
                }
            }
        });
        cells[u] = set;
    }
    list.sort((x, y) => x.universe - y.universe || x.start - y.start);
    return { cells: cells, list: list };
}

function buildIssueItem(kind, text, onClick) {
    const el = document.createElement('div');
    el.className = 'issue-item ' + kind;
    el.textContent = text;
    if (onClick) el.addEventListener('click', onClick);
    return el;
}

function renderIssues() {
    const container = document.getElementById('issues-container');
    const listEl = document.getElementById('issues-list');
    if (!container || !listEl) return;

    const hasPatch = Object.keys(parsedUniverses).length > 0;
    if (!hasPatch) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    listEl.innerHTML = '';

    const conflicts = computeConflicts().list;
    const MAX_SHOWN = 40;
    let issueCount = 0;

    conflicts.slice(0, MAX_SHOWN).forEach(c => {
        const range = c.start === c.end ? `${c.start}` : `${c.start}-${c.end}`;
        listEl.appendChild(buildIssueItem('error', `U${c.universe}.${range}: ${c.a.id} overlaps ${c.b.id}`, () => changeUniverse(c.universe)));
    });
    issueCount += conflicts.length;
    if (conflicts.length > MAX_SHOWN) {
        listEl.appendChild(buildIssueItem('muted', `+${conflicts.length - MAX_SHOWN} more overlaps`));
    }

    const uncertainByType = {};
    for (let u in parsedUniverses) {
        parsedUniverses[u].forEach(f => {
            if (f.clipped) {
                issueCount++;
                listEl.appendChild(buildIssueItem('warning', `${f.id} needs ${f.baseFootprint} ch but only ${f.footprint} fit at U${f.universe}.${f.address}`, () => changeUniverse(f.universe)));
            }
            if (f.uncertain) {
                if (!uncertainByType[f.type]) uncertainByType[f.type] = { count: 0, sample: f };
                uncertainByType[f.type].count++;
            }
        });
    }
    Object.keys(uncertainByType).forEach(type => {
        issueCount++;
        const t = uncertainByType[type];
        listEl.appendChild(buildIssueItem('info', `${type}: footprint estimated (${t.sample.footprint} ch, ${t.count} fixtures). Click to set it.`, () => {
            changeUniverse(t.sample.universe);
            openLayerEditor(t.sample.layer || 'No Layer');
        }));
    });

    if (issueCount === 0) {
        listEl.appendChild(buildIssueItem('ok', 'No overlaps or footprint warnings.'));
    }
    document.getElementById('issues-count').textContent = conflicts.length > 0 ? `${conflicts.length} overlap${conflicts.length > 1 ? 's' : ''}` : '';
}

function renderPending() {
    const container = document.getElementById('pending-container');
    const listEl = document.getElementById('pending-list');
    if (!container || !listEl) return;
    if (pendingMoves.size === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    listEl.innerHTML = '';
    const fmt = p => `${p.universe}.${String(p.address).padStart(3, '0')}`;
    pendingMoves.forEach((m, id) => {
        const row = document.createElement('div');
        row.className = 'pending-item';
        const label = document.createElement('span');
        label.textContent = `${id}   ${fmt(m.from)} \u2192 ${fmt(m.to)}`;
        const btn = document.createElement('button');
        btn.className = 'dmx-btn-icon';
        btn.title = 'Revert this change';
        btn.textContent = '\u2715';
        btn.addEventListener('click', () => revertMove(id));
        row.appendChild(label);
        row.appendChild(btn);
        listEl.appendChild(row);
    });
}

function renderPanels() {
    renderIssues();
    renderPending();
    const sendBtn = document.getElementById('btn-send-changes');
    const undoBtn = document.getElementById('btn-undo-move');
    const count = document.getElementById('pending-count');
    if (sendBtn) sendBtn.disabled = pendingMoves.size === 0;
    if (undoBtn) undoBtn.disabled = moveHistory.length === 0;
    if (count) count.textContent = pendingMoves.size > 0 ? pendingMoves.size : '';
}

// ============================================================
// Drag & drop re-addressing
// ============================================================
let dragState = null;
let dragLabel = null;
let dragPreviewEls = [];
let dwellTimer = null;
let dwellUni = null;

function chFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const blk = el && el.closest ? el.closest('.fixture-block') : null;
    if (!blk || !blk.dataset.start) return null;
    const start = parseInt(blk.dataset.start);
    const count = parseInt(blk.dataset.count);
    const r = blk.getBoundingClientRect();
    let i = Math.floor((x - r.left) / r.width * count);
    i = Math.max(0, Math.min(count - 1, i));
    return start + i;
}

function onBlockPointerDown(e, fixture, block) {
    if (e.button !== 0 || !(fixture.fixtureNum > 0) || dragState) return;
    const chUnder = chFromPoint(e.clientX, e.clientY);
    dragState = {
        f: fixture,
        grab: (chUnder !== null ? chUnder : block.start) - fixture.address,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        target: null
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('keydown', onDragKey);
}

function markDragSource() {
    if (!dragState) return;
    document.querySelectorAll('.fixture-block').forEach(b => {
        b.classList.toggle('drag-source', b.dataset.fid === dragState.f.id);
    });
}

function clearDragPreview() {
    dragPreviewEls.forEach(el => el.classList.remove('drag-preview', 'drag-preview-bad'));
    dragPreviewEls = [];
}

function updateDragPreview() {
    clearDragPreview();
    if (!dragState || !dragState.target) return;
    const f = dragState.f;
    const t = dragState.target;
    if (t.universe !== currentUniverse) return;
    const size = f.baseFootprint || f.footprint;
    const occ = new Array(MAX_CHANNELS + 2).fill(false);
    (parsedUniverses[currentUniverse] || []).forEach(o => {
        if (o === f) return;
        for (let ch = o.address; ch < o.address + o.footprint && ch <= MAX_CHANNELS; ch++) occ[ch] = true;
    });
    let bad = false;
    for (let ch = t.address; ch < t.address + size && ch <= MAX_CHANNELS; ch++) if (occ[ch]) bad = true;
    dragState.bad = bad;
    for (let ch = t.address; ch < t.address + size && ch <= MAX_CHANNELS; ch++) {
        const el = cellEls[ch];
        if (!el) continue;
        el.classList.add(bad ? 'drag-preview-bad' : 'drag-preview');
        dragPreviewEls.push(el);
    }
}

function onDragMove(e) {
    if (!dragState) return;
    if (!dragState.active) {
        if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) < 5) return;
        dragState.active = true;
        document.body.classList.add('dmx-dragging');
        document.getElementById('fixture-tooltip').classList.remove('visible');
        dragLabel = document.createElement('div');
        dragLabel.className = 'drag-label';
        document.body.appendChild(dragLabel);
        markDragSource();
    }
    e.preventDefault();

    const ch = chFromPoint(e.clientX, e.clientY);
    if (ch !== null) {
        const size = dragState.f.baseFootprint || dragState.f.footprint;
        const maxStart = Math.max(1, MAX_CHANNELS - size + 1);
        const addr = Math.max(1, Math.min(maxStart, ch - dragState.grab));
        dragState.target = { universe: currentUniverse, address: addr };
        updateDragPreview();
    }

    // Hovering a universe button for a moment switches to that universe
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const btn = el && el.closest ? el.closest('.universe-btn') : null;
    const hoverUni = btn ? parseInt(btn.id.replace('uni-btn-', '')) : null;
    if (hoverUni && hoverUni !== currentUniverse) {
        if (dwellUni !== hoverUni) {
            clearTimeout(dwellTimer);
            dwellUni = hoverUni;
            dwellTimer = setTimeout(() => {
                dwellUni = null;
                if (!dragState) return;
                changeUniverse(hoverUni);
                dragState.target = null;
                markDragSource();
            }, 450);
        }
    } else if (!hoverUni) {
        clearTimeout(dwellTimer);
        dwellUni = null;
    }
    dragState.dropUni = hoverUni;

    if (dragLabel) {
        const t = dragState.target;
        dragLabel.textContent = t ? `${dragState.f.id} \u2192 ${t.universe}.${String(t.address).padStart(3, '0')}` : dragState.f.id;
        dragLabel.classList.toggle('bad', !!(t && dragState.bad && t.universe === currentUniverse));
        dragLabel.style.left = (e.clientX + 16) + 'px';
        dragLabel.style.top = (e.clientY + 16) + 'px';
    }
}

function endDrag() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('keydown', onDragKey);
    clearTimeout(dwellTimer);
    dwellUni = null;
    clearDragPreview();
    document.body.classList.remove('dmx-dragging');
    if (dragLabel) { dragLabel.remove(); dragLabel = null; }
    document.querySelectorAll('.fixture-block.drag-source').forEach(b => b.classList.remove('drag-source'));
    dragState = null;
}

function onDragEnd(e) {
    if (!dragState) return;
    const st = dragState;
    endDrag();
    if (!st.active) return;

    let target = st.target;
    // Dropped straight onto a universe button: keep the address, change universe
    if (st.dropUni && st.dropUni !== st.f.universe && !(target && target.universe === st.dropUni)) {
        target = { universe: st.dropUni, address: Math.min(st.f.address, Math.max(1, MAX_CHANNELS - (st.f.baseFootprint || st.f.footprint) + 1)) };
    }
    if (!target) return;
    stageMove(st.f, target.universe, target.address);
    if (target.universe !== currentUniverse) changeUniverse(target.universe);
    if (conflictState.list.some(c => c.a === st.f || c.b === st.f)) {
        showToast("Moved, but it overlaps another fixture.", "warning");
    }
}

function onDragKey(e) {
    if (e.key === 'Escape' && dragState) endDrag();
}

// ============================================================
// Live DMX (Art-Net input)
// ============================================================
let liveActive = false;
let liveSignalsConnected = false;
let liveTimer = null;
let liveFrameQueued = false;
let lastLevels = [];
let hoverCh = 0;
const liveData = new Map();     // Art-Net universe -> { data, t, src }
const liveSeen = new Set();     // MA2 universe numbers currently receiving data

// Same addressing as the Art-Net viewer (Net:Subnet:Universe, 0-based): MA2 universe 1 = Art-Net 0.0.0
function liveArtnetUniverse(ma2Uni) { return ma2Uni - 1; }

function formatArtnetAddress(artUni) {
    return `${(artUni >> 8) & 0x7F}:${(artUni >> 4) & 0x0F}:${artUni & 0x0F}`;
}

function onLiveData(artUni, data, srcIp) {
    liveData.set(artUni, { data: data, t: Date.now(), src: srcIp });
    // Only list universes that actually carry levels (all-zero universes are just noise)
    if (!liveSeen.has(artUni + 1) && data.some(v => v > 0)) {
        liveSeen.add(artUni + 1);
        initUniverseSelector();
    }
    if (!liveFrameQueued) {
        liveFrameQueued = true;
        requestAnimationFrame(() => { liveFrameQueued = false; refreshLiveCells(false); });
    }
}

function refreshLiveCells(force) {
    const entry = liveActive ? liveData.get(liveArtnetUniverse(currentUniverse)) : null;
    const fresh = entry && (Date.now() - entry.t) < 3000;
    for (let ch = 1; ch <= MAX_CHANNELS; ch++) {
        const v = fresh ? (entry.data[ch - 1] || 0) : 0;
        if (!force && lastLevels[ch] === v) continue;
        lastLevels[ch] = v;
        const el = levelEls[ch];
        if (el) el.style.height = (v / 255 * 100) + '%';
    }
    updateTooltipLive();
    updateLiveUI();
}

function updateTooltipLive() {
    const el = document.getElementById('tip-live');
    if (!el) return;
    const v = lastLevels[hoverCh];
    el.textContent = hoverCh ? `Ch ${hoverCh} = ${v || 0}` : '';
}

function updateLiveUI() {
    const btn = document.getElementById('btn-live-toggle');
    const status = document.getElementById('live-status');
    if (btn) {
        btn.textContent = liveActive ? 'Stop Live DMX' : 'Start Live DMX';
        btn.classList.toggle('live-on', liveActive);
    }
    if (!status) return;
    if (!liveActive) { status.textContent = 'Off. Listens for Art-Net on UDP 6454.'; return; }
    const artUni = liveArtnetUniverse(currentUniverse);
    const entry = liveData.get(artUni);
    if (entry && (Date.now() - entry.t) < 3000) status.textContent = `Art-Net ${formatArtnetAddress(artUni)} from ${entry.src}`;
    else status.textContent = `Waiting for Art-Net ${formatArtnetAddress(artUni)} on ${getLiveBindIp()}...`;
}

// Same adapter logic as the Art-Net viewer: default to the adapter on the saved MA2 IP's subnet
function getLiveBindIp() {
    const sel = document.getElementById('live-adapter');
    return sel ? sel.value : '0.0.0.0';
}

function populateLiveAdapters(ips) {
    const sel = document.getElementById('live-adapter');
    if (!sel) return;
    sel.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '0.0.0.0';
    allOpt.textContent = '0.0.0.0 (All Interfaces)';
    sel.appendChild(allOpt);
    ips.forEach(adapterStr => {
        const opt = document.createElement('option');
        opt.value = adapterStr.split(' - ')[0];
        opt.textContent = adapterStr;
        opt.title = adapterStr;
        sel.appendChild(opt);
    });
    sel.title = sel.options[sel.selectedIndex].textContent;

    if (pyBridge && pyBridge.get_saved_credentials) {
        pyBridge.get_saved_credentials(credsStr => {
            try {
                const creds = JSON.parse(credsStr);
                const parts = (creds && creds.ip ? creds.ip : '').split('.');
                if (parts.length !== 4) return;
                const subnet = parts[0] + '.' + parts[1] + '.' + parts[2] + '.';
                const match = Array.from(sel.options).find(o => o.value.startsWith(subnet));
                if (match) { sel.value = match.value; sel.title = match.textContent; }
            } catch (e) {}
        });
    }
}

function onLiveAdapterChange() {
    const sel = document.getElementById('live-adapter');
    if (sel) sel.title = sel.options[sel.selectedIndex].textContent;
    if (!liveActive || !pyBridge) return;
    liveData.clear();
    liveSeen.clear();
    initUniverseSelector();
    pyBridge.artnet_start(getLiveBindIp(), function(resStr) {
        let res = null;
        try { res = JSON.parse(resStr); } catch (e) {}
        if (!res || !res.success) showToast((res && res.error) || "Could not switch adapter", "error");
        refreshLiveCells(true);
    });
}

function toggleLive() {
    if (!pyBridge || !pyBridge.artnet_start) return showToast("Bridge not ready", "error");
    if (liveActive) { stopLive(); return; }
    if (!liveSignalsConnected) {
        pyBridge.artnet_universe_data.connect(onLiveData);
        pyBridge.artnet_error.connect(msg => showToast("Art-Net: " + msg, "error"));
        liveSignalsConnected = true;
    }
    pyBridge.artnet_start(getLiveBindIp(), resStr => {
        let res = null;
        try { res = JSON.parse(resStr); } catch (e) {}
        if (!res || !res.success) return showToast((res && res.error) || "Could not start Art-Net listener", "error");
        liveActive = true;
        liveTimer = setInterval(() => refreshLiveCells(false), 1000);
        if (document.getElementById('dmx-grid-container').style.display === 'none') renderGrid();
        refreshLiveCells(true);
        showToast("Live DMX listening for Art-Net", "success");
    });
}

function stopLive() {
    if (pyBridge && pyBridge.artnet_stop) pyBridge.artnet_stop(function() {});
    liveActive = false;
    clearInterval(liveTimer);
    liveData.clear();
    liveSeen.clear();
    initUniverseSelector();
    refreshLiveCells(true);
}

document.addEventListener('visibilitychange', () => {
    // Re-join the shared Art-Net listener after the window was minimised/restored
    if (!document.hidden && liveActive && pyBridge && pyBridge.artnet_start) pyBridge.artnet_start(getLiveBindIp(), function() {});
});

window.addEventListener('pagehide', () => { if (liveActive) stopLive(); });
