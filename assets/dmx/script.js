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
                pyBridge.progress_update.connect(updateLoadingOverlay);
            }
            if (pyBridge.patch_pulled) {
                pyBridge.patch_pulled.connect(function(patchResStr) {
                    hideLoadingOverlay();
                    try {
                        let response = JSON.parse(patchResStr);
                        if (response.success) {
                            parsePatchXML(response.data);
                            showToast(`Patch pulled successfully!`, "success");
                        } else {
                            if (response.error !== "Cancelled") showToast("Patch Error: " + response.error, "error");
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

let displayedUniversesCount = 8;

function initUniverseSelector() {
    const list = document.getElementById('universe-sidebar-list');
    if (!list) return;
    list.innerHTML = '';
    for (let i = 1; i <= displayedUniversesCount; i++) {
        const btn = document.createElement('div');
        btn.className = `universe-btn ${i === currentUniverse ? 'active' : ''}`;
        btn.id = `uni-btn-${i}`;
        btn.onclick = () => changeUniverse(i);
        
        btn.innerHTML = `
            <span>Universe ${i}</span>
            <span class="universe-btn-badge" id="uni-badge-${i}">0 Fix • 0 Ch</span>
        `;
        list.appendChild(btn);
    }
}

function changeUniverse(num) {
    currentUniverse = num;
    for (let i = 1; i <= displayedUniversesCount; i++) {
        const btn = document.getElementById(`uni-btn-${i}`);
        if (btn) {
            if (i === num) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }
    renderGrid();
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
function updateLoadingOverlay(msg) {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    if (overlay && text) {
        text.textContent = msg;
        overlay.classList.add('active');
    }
}
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('active');
}

function showToast(message, type = 'default', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    const colors = { success: '#00e676', error: '#ff5252', info: '#29b6f6', warning: '#ffa726', default: '#e0e0e0' };
    toast.style.borderLeft = `3px solid ${colors[type] || colors.default}`;
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
    displayedUniversesCount = 8;
    initUniverseSelector();
    for (let i = 1; i <= displayedUniversesCount; i++) {
        let badge = document.getElementById(`uni-badge-${i}`);
        if (badge) badge.textContent = `0 Fix • 0 Ch`;
    }
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
        if (!response.success) { if (response.error !== "Cancelled") showToast("Error: " + response.error, "error"); return; }
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
                        updateLoadingOverlay("Connecting to MA2 for Patch...");
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
    
    updateLoadingOverlay("Connecting to MA2 for Patch...");
    pyBridge.pull_patch(loginStr);
}

function parsePatchXML(xmlString) {
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
                if (!isNaN(absoluteAddr)) {
                    let universe = Math.floor((absoluteAddr - 1) / 512) + 1;
                    let relativeAddr = ((absoluteAddr - 1) % 512) + 1;
                    
                    let tagsFootprint = n.querySelectorAll('Channel').length;
                    
                    tempFixtures.push({
                        id: displayId,
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
            if (f.address + f.footprint - 1 > MAX_CHANNELS) {
                f.footprint = MAX_CHANNELS - f.address + 1;
            }
            
            if (!parsedUniverses[f.universe]) {
                parsedUniverses[f.universe] = [];
            }
            parsedUniverses[f.universe].push(f);
        }
        
        let populatedUniverses = Object.keys(parsedUniverses).map(Number).sort((a, b) => a - b);
        let highestPopulated = populatedUniverses.length > 0 ? Math.max(...populatedUniverses) : 8;
        displayedUniversesCount = Math.max(8, highestPopulated);
        initUniverseSelector();
        
        // Auto-select first populated universe within limits
        for (let i = 1; i <= displayedUniversesCount; i++) {
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
        
        let targetUni = populatedUniverses.find(u => u <= 8);
        
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

function renderGrid() {
    const emptyState = document.getElementById('empty-state');
    const container = document.getElementById('dmx-grid-container');
    
    if (Object.keys(parsedUniverses).length === 0) {
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
    
    // Create map of cell index (1 to 512) to fixture data
    let cellMap = {};
    fixturesInUniverse.forEach(f => {
        // Head
        cellMap[f.address] = { type: 'head', fixture: f };
        // Body (Footprint)
        for (let i = 1; i < f.footprint; i++) {
            let addr = f.address + i;
            if (addr <= MAX_CHANNELS) {
                cellMap[addr] = { type: 'body', fixture: f };
            }
        }
    });

    const tooltip = document.getElementById('fixture-tooltip');

    let blocks = [];
    let currentBlock = null;

    for (let i = 1; i <= MAX_CHANNELS; i++) {
        let mapping = cellMap[i];
        let fixtureId = mapping ? mapping.fixture.id : null;
        let isRowStart = ((i - 1) % 32 === 0);
        
        if (!currentBlock || currentBlock.fixtureId !== fixtureId || isRowStart) {
            currentBlock = {
                fixtureId: fixtureId,
                fixture: mapping ? mapping.fixture : null,
                start: i,
                channels: [i]
            };
            blocks.push(currentBlock);
        } else {
            currentBlock.channels.push(i);
        }
    }

    blocks.forEach(block => {
        const blockEl = document.createElement('div');
        blockEl.className = 'fixture-block';
        if (block.fixture) blockEl.classList.add('is-patched');
        
        blockEl.style.gridColumn = `span ${block.channels.length}`;
        
        let headerHtml = '';
        let colorHex = '#4CAF50';
        if (block.fixture) {
            colorHex = getFixtureColorHex(block.fixture);
            blockEl.style.backgroundColor = colorHex + '15'; // 15% opacity
            headerHtml = `<div class="fixture-header" style="background-color: ${colorHex}40;">${escXML(block.fixture.name)}</div>`;
        }

        let channelsHtml = `<div class="channels-container">
            ${block.channels.map(ch => `
                <div class="channel-cell">
                    <div class="channel-number">${ch}</div>
                    <div class="channel-line" style="${block.fixture ? `background-color: ${colorHex}99;` : ''}"></div>
                </div>
            `).join('')}
        </div>`;

        blockEl.innerHTML = channelsHtml + headerHtml;

        if (block.fixture) {
            blockEl.addEventListener('mouseenter', () => {
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
                `;
                tooltip.classList.add('visible');
            });
            
            blockEl.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
        }

        grid.appendChild(blockEl);
    });
    container.appendChild(grid);
    
    // --- Generate Legend ---
    const legendContainer = document.getElementById('fixture-legend-container');
    const legendList = document.getElementById('fixture-legend-list');
    
    let uniqueLayers = {};
    // Gather all fixtures in the showfile, not just current universe, to show accurate layer data
    Object.values(parsedUniverses).flat().forEach(f => {
        let layerName = f.layer || 'No Layer';
        if (!uniqueLayers[layerName]) {
            uniqueLayers[layerName] = { layer: layerName, color: getFixtureColorHex(f), fixtureTypes: {} };
        }
        uniqueLayers[layerName].fixtureTypes[f.type] = f.footprint;
    });

    legendList.innerHTML = '';
    let uniqueArr = Object.values(uniqueLayers);
    // Expose globally for the modal editor
    window.currentUniqueLayers = uniqueLayers;

    if (uniqueArr.length > 0) {
        legendContainer.style.display = 'block';
        uniqueArr.forEach(t => {
            let el = document.createElement('div');
            el.className = 'legend-item';
            // We use encodeURIComponent in case layer name has quotes or special chars
            let safeLayer = encodeURIComponent(t.layer);
            el.innerHTML = `
                <div class="legend-item-left">
                    <div class="color-swatch" style="background-color: ${t.color}"></div>
                    <div class="legend-name" title="Layer: ${escXML(t.layer)}">${escXML(t.layer)}</div>
                </div>
                <button class="dmx-btn-icon" onclick="openLayerEditor(decodeURIComponent('${safeLayer}'))">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
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
                f.footprint = footprint;
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
            parsePatchXML(window._currentPatchXML);
        }
    }
    
    closeModal('layer-editor-modal');
}
