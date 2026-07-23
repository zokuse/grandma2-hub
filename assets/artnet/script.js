let pyBridge = null;
let isMonitoring = false;
let canvasNeedsRender = true;

window.onerror = function(msg, url, line) {
    showToast("ERR: " + msg + " line: " + line, "error", 8000);
};

// Selection State
let currentNet = 0;
let currentSubnet = 0;
let currentUniverse = 0; // 0-15

// Buffers
const universeBuffer = new Map(); // Map<universeId (15-bit), dataArray>
const universeLastSeen = new Map(); // universeId -> timestamp
const nodeMap = new Map(); // Map<ip, {shortName, longName, lastSeen}>
const OFFLINE_THRESHOLD_MS = 3000;
const PURGE_THRESHOLD_MS = 15000;

// Active traffic tracking for UI
const activeSubnets = new Set(); // Set of "net:subnet" strings
const activeUniverses = new Set(); // Set of "net:subnet:uni" strings

// Canvas Contexts
let canvas, ctx;
let chartCanvas, chartCtx;
let cellSize = 44; 
const GRID_COLS = 32;
const GRID_ROWS = 16;
let animationFrameId = null;
let hoveredChannelIdx = -1;

function escXML(str) {
    if (!str) return '';
    return String(str).replace(/[<>&'"]/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;',
        "'": '&apos;', '"': '&quot;'
    }[c]));
}

function resizeMainCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement; 
    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;

    const widthBasedSize = Math.floor(availableWidth / GRID_COLS);
    const heightBasedSize = Math.floor(availableHeight / GRID_ROWS);
    cellSize = Math.max(16, Math.min(44, widthBasedSize, heightBasedSize));

    canvas.width = GRID_COLS * cellSize * dpr;
    canvas.height = GRID_ROWS * cellSize * dpr;
    canvas.style.width = (GRID_COLS * cellSize) + 'px';
    canvas.style.height = (GRID_ROWS * cellSize) + 'px';
    ctx.scale(dpr, dpr);

    canvasNeedsRender = true;
}

// Stats & Chart
let packetsSinceLastTick = 0;
let currentPacketsPerSecond = 0;
const CHART_MAX_POINTS = 60;
const packetsHistory = new Array(CHART_MAX_POINTS).fill(0);

document.addEventListener("DOMContentLoaded", function() {
    canvas = document.getElementById('dmx-canvas');
    ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    resizeMainCanvas();

    chartCanvas = document.getElementById('chart-canvas');
    chartCtx = chartCanvas.getContext('2d');
    
    // Scale chart canvas based on its display size
    const cwInit = chartCanvas.clientWidth;
    const chInit = chartCanvas.clientHeight;
    chartCanvas.width = cwInit * dpr;
    chartCanvas.height = chInit * dpr;
    chartCtx.scale(dpr, dpr);
    
    // Connect bridge
    let checkInterval;
    function initBridge() {
        if (typeof qt !== 'undefined' && qt.webChannelTransport) {
            new QWebChannel(qt.webChannelTransport, function(channel) {
                window.pyBridge = channel.objects.backend;
                pyBridge = window.pyBridge;
                
                setupSignals();
                initializeNetworkSettings();
                
                // Fetch initially known universes
                pyBridge.artnet_get_active_universes(function(resStr) {
                    const res = JSON.parse(resStr);
                    if (res.success && res.data) {
                        res.data.forEach(u => processIncomingUniverse(u.universe));
                    }
                });
            });
            clearInterval(checkInterval);
        }
    }
    checkInterval = setInterval(initBridge, 100);
    initBridge();

    setupTooltip();
    initGridUI();

    // Visibility change handling
    document.addEventListener("visibilitychange", function() {
        const selectEl = document.getElementById('network-adapter');
        const bindIp = selectEl ? selectEl.value : '0.0.0.0';
        if (document.hidden) {
            if (isMonitoring) pyBridge.artnet_stop(function(){});
        } else {
            if (isMonitoring) pyBridge.artnet_start(bindIp, function(){});
        }
    });

    // Handle resizing chart
    window.addEventListener('resize', () => {
        resizeMainCanvas();

        const dpr = window.devicePixelRatio || 1;
        const cw = chartCanvas.clientWidth;
        const ch = chartCanvas.clientHeight;
        chartCanvas.width = cw * dpr;
        chartCanvas.height = ch * dpr;
        chartCtx.scale(dpr, dpr);
    });

    // 1-second Stats Tick
    setInterval(() => {
        if (!isMonitoring || document.hidden) return;
        
        currentPacketsPerSecond = packetsSinceLastTick;
        packetsHistory.shift();
        packetsHistory.push(currentPacketsPerSecond);
        packetsSinceLastTick = 0;
        
        document.getElementById('header-packets-rate').textContent = currentPacketsPerSecond;
        
        const badge = document.getElementById('chart-current-value');
        if(badge) badge.textContent = currentPacketsPerSecond;

        renderChart();
        
    }, 1000);

    // Staleness prune
    setInterval(() => {
        const now = Date.now();
        let changed = false;

        for (const [uniId, lastSeen] of universeLastSeen) {
            const age = now - lastSeen;
            if (age > PURGE_THRESHOLD_MS) {
                universeBuffer.delete(uniId);
                universeLastSeen.delete(uniId);

                const net = (uniId >> 8) & 0x7F;
                const subnet = (uniId >> 4) & 0x0F;
                const uni = uniId & 0x0F;
                activeUniverses.delete(`${net}:${subnet}:${uni}`);
                
                const stillHasUniverse = [...activeUniverses].some(k => k.startsWith(`${net}:${subnet}:`));
                if (!stillHasUniverse) activeSubnets.delete(`${net}:${subnet}`);

                changed = true;
            } else if (age > OFFLINE_THRESHOLD_MS) {
                // Just trigger a UI update so they get marked as offline
                changed = true;
            }
        }

        // Prune stale nodes
        for (const [ip, info] of nodeMap) {
            if (now - info.lastSeen > PURGE_THRESHOLD_MS) {
                nodeMap.delete(ip);
                changed = true;
            }
        }

        if (changed) {
            renderGridUI();
            updateNodeList();
            canvasNeedsRender = true;
        }
    }, 1000);
});

function setupSignals() {
    if (pyBridge && pyBridge.artnet_universe_data) {
        pyBridge.artnet_universe_data.connect((universeId, data, sourceIp) => {
            packetsSinceLastTick++;
            universeBuffer.set(universeId, data);
            universeLastSeen.set(universeId, Date.now());
            if (universeId === getSelectedUniverseId()) {
                canvasNeedsRender = true;
            }
            processIncomingUniverse(universeId);
        });

        pyBridge.artnet_node_update.connect((ip, info) => {
            nodeMap.set(ip, info);
            updateNodeList();
        });

        pyBridge.artnet_error.connect((msg) => {
            if (msg.includes('EADDRNOTAVAIL')) {
                const selectEl = document.getElementById('network-adapter');
                if (selectEl && selectEl.value !== '0.0.0.0') {
                    showToast(`Adapter ${selectEl.value} unavailable. Falling back to All Interfaces.`, "warning", 6000);
                    selectEl.value = '0.0.0.0';
                    selectEl.dispatchEvent(new Event('change'));
                    return;
                }
            }
            showToast("Art-Net Error: " + msg, "error");
            isMonitoring = false;
        });
    }
}

// ---------------------------------------------------------
// Logic & UI
// ---------------------------------------------------------
function getSelectedUniverseId() {
    return (currentNet << 8) | (currentSubnet << 4) | currentUniverse;
}

function processIncomingUniverse(universeId) {
    const net = (universeId >> 8) & 0x7F;
    const subnet = (universeId >> 4) & 0x0F;
    const uni = universeId & 0x0F;

    const subKey = `${net}:${subnet}`;
    const uniKey = `${net}:${subnet}:${uni}`;

    let needsRender = false;
    if (!activeSubnets.has(subKey)) {
        activeSubnets.add(subKey);
        needsRender = true;
    }
    if (!activeUniverses.has(uniKey)) {
        activeUniverses.add(uniKey);
        needsRender = true;
    }

    // Auto-select first seen traffic if we are at default 0,0,0 and nothing was seen before
    if (currentNet === 0 && currentSubnet === 0 && currentUniverse === 0 && activeUniverses.size === 1) {
        currentNet = net;
        currentSubnet = subnet;
        currentUniverse = uni;
        updateHeaderLabel();
        needsRender = true;
    }

    if (needsRender) {
        renderGridUI();
    }
}

function initGridUI() {
    const subContainer = document.getElementById('subnet-grid');
    const uniContainer = document.getElementById('universe-grid');
    subContainer.innerHTML = '';
    uniContainer.innerHTML = '';
    
    for (let i = 0; i < 16; i++) {
        // Subnet Button
        const sb = document.createElement('div');
        sb.className = 'grid-btn';
        sb.id = `btn-sub-${i}`;
        sb.textContent = i;
        sb.onclick = () => { currentSubnet = i; updateHeaderLabel(); renderGridUI(); canvasNeedsRender = true; };
        subContainer.appendChild(sb);

        // Universe Button
        const ub = document.createElement('div');
        ub.className = 'grid-btn';
        ub.id = `btn-uni-${i}`;
        ub.textContent = i;
        ub.onclick = () => { currentUniverse = i; updateHeaderLabel(); renderGridUI(); canvasNeedsRender = true; };
        uniContainer.appendChild(ub);
    }
    renderGridUI();
    updateHeaderLabel();
}


function updateHeaderLabel() {
    document.getElementById('stat-net').textContent = currentNet;
    document.getElementById('stat-sub').textContent = currentSubnet;
    document.getElementById('stat-uni').textContent = currentUniverse;
}

function renderGridUI() {
    const now = Date.now();
    for (let i = 0; i < 16; i++) {
        // Subnet
        const sb = document.getElementById(`btn-sub-${i}`);
        if (sb) {
            const hasData = activeSubnets.has(`${currentNet}:${i}`);
            let isOffline = false;
            if (hasData) {
                const unis = [...activeUniverses].filter(k => k.startsWith(`${currentNet}:${i}:`));
                isOffline = unis.every(uKey => {
                    const parts = uKey.split(':');
                    const uId = (parseInt(parts[0]) << 8) | (parseInt(parts[1]) << 4) | parseInt(parts[2]);
                    return (now - (universeLastSeen.get(uId) || 0)) > OFFLINE_THRESHOLD_MS;
                });
            }
            sb.className = 'grid-btn' + (hasData ? ' has-data' : '') + (isOffline ? ' offline' : '') + (currentSubnet === i ? ' selected' : '');
        }

        // Universe
        const ub = document.getElementById(`btn-uni-${i}`);
        if (ub) {
            const uKey = `${currentNet}:${currentSubnet}:${i}`;
            const hasData = activeUniverses.has(uKey);
            let isOffline = false;
            if (hasData) {
                const uId = (currentNet << 8) | (currentSubnet << 4) | i;
                isOffline = (now - (universeLastSeen.get(uId) || 0)) > OFFLINE_THRESHOLD_MS;
            }
            ub.className = 'grid-btn' + (hasData ? ' has-data' : '') + (isOffline ? ' offline' : '') + (currentUniverse === i ? ' selected' : '');
        }
    }
}

function updateNodeList() {
    const container = document.getElementById('node-list-container');
    if (nodeMap.size === 0) {
        container.innerHTML = `
            <div id="empty-node-state" style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-m); padding: 24px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: rgba(255,255,255,0.2);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <p style="font-size: 12px; color: var(--text-muted-color); margin: 0; line-height: 1.4;">No nodes found.<br/><span style="color: rgba(255,255,255,0.3); font-size: 11px;">Broadcast ArtPoll to discover.</span></p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    nodeMap.forEach((info, ip) => {
        const item = document.createElement('div');
        item.className = 'node-item';
        const safeIp = escXML(ip);
        const safeShort = escXML(info.shortName || 'Unknown Node');
        const safeLong = escXML(info.longName || '');
        item.innerHTML = `
            <div class="node-item-ip">${safeIp}</div>
            <div class="node-item-name" title="${safeShort}">${safeShort}</div>
            <div class="node-item-long" title="${safeLong}">${safeLong}</div>
        `;
        container.appendChild(item);
    });
}

// ---------------------------------------------------------
// Chart Rendering
// ---------------------------------------------------------
function renderChart() {
    const dpr = window.devicePixelRatio || 1;
    
    const currentCw = chartCanvas.clientWidth;
    const currentCh = chartCanvas.clientHeight;
    
    if (currentCw === 0 || currentCh === 0) return; // Layout not ready

    if (chartCanvas.width !== currentCw * dpr || chartCanvas.height !== currentCh * dpr) {
        chartCanvas.width = currentCw * dpr;
        chartCanvas.height = currentCh * dpr;
        chartCtx.scale(dpr, dpr);
    }

    const cw = currentCw;
    const ch = currentCh;
    chartCtx.clearRect(0, 0, cw, ch);
    
    const data = packetsHistory;
    let dataMax = Math.max(...data, 0);

    let step = 20;
    if (dataMax > 80) step = 50;
    if (dataMax > 200) step = 100;
    if (dataMax > 800) step = 500;
    if (dataMax > 4000) step = 1000;
    
    let maxVal = Math.ceil(dataMax / step) * step;
    if (maxVal < 40) {
        maxVal = 40;
        step = 20;
    }
    
    const numLines = maxVal / step;
    const lineVals = [];
    for (let i = 0; i <= numLines; i++) {
        lineVals.push(i * step);
    }

    // Gridlines (Lines only, drawn BEFORE chart)
    chartCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    chartCtx.lineWidth = 1;
    lineVals.forEach(val => {
        const frac = 1 - (val / maxVal);
        const y = 15 + frac * (ch - 25);
        const crispY = Math.floor(y) + 0.5;
        chartCtx.beginPath();
        chartCtx.moveTo(0, crispY);
        chartCtx.lineTo(cw, crispY);
        chartCtx.stroke();
    });
    
    chartCtx.beginPath();
    chartCtx.strokeStyle = 'rgba(253, 216, 53, 0.8)';
    chartCtx.lineWidth = 2;
    chartCtx.lineJoin = 'round';
    
    const stepX = cw / (CHART_MAX_POINTS - 1);
    
    for (let i = 0; i < CHART_MAX_POINTS; i++) {
        const val = data[i];
        const x = i * stepX;
        // Padding bottom 10px, top 15px
        const y = ch - 10 - ((val / maxVal) * (ch - 25));
        
        if (i === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
    }
    
    chartCtx.stroke();
    
    // Fill gradient
    chartCtx.lineTo(cw, ch);
    chartCtx.lineTo(0, ch);
    chartCtx.closePath();
    
    const grad = chartCtx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, 'rgba(253, 216, 53, 0.2)');
    grad.addColorStop(1, 'rgba(253, 216, 53, 0.0)');
    chartCtx.fillStyle = grad;
    chartCtx.fill();

    // Labels (drawn AFTER chart so they are crisp and on top)
    chartCtx.font = '8px monospace';
    chartCtx.fillStyle = '#555';
    chartCtx.textBaseline = 'bottom';
    lineVals.forEach(val => {
        const frac = 1 - (val / maxVal);
        const y = 15 + frac * (ch - 25);
        const crispY = Math.floor(y) + 0.5;
        chartCtx.fillText(val.toString(), 4, crispY - 3);
    });

    // Current-value badge at the leading (right) edge
    const currentVal = data[data.length - 1];
    const lastY = ch - 10 - ((currentVal / maxVal) * (ch - 25));
    chartCtx.fillStyle = 'rgba(253, 216, 53, 0.9)';
    chartCtx.beginPath();
    chartCtx.arc(cw - 3, lastY, 3, 0, Math.PI * 2);
    chartCtx.fill();


}

// ---------------------------------------------------------
// Drawing (Canvas Render Loop)
// ---------------------------------------------------------
function initializeNetworkSettings() {
    pyBridge.get_saved_credentials((credsStr) => {
        let savedIp = null;
        try {
            const creds = JSON.parse(credsStr);
            if (creds && creds.ip) savedIp = creds.ip;
        } catch (e) {}
        
        pyBridge.get_local_ips((ipsStr) => {
            const ips = JSON.parse(ipsStr);
            const selectEl = document.getElementById('network-adapter');
            selectEl.innerHTML = '';
            
            const allOpt = document.createElement('option');
            allOpt.value = '0.0.0.0';
            allOpt.textContent = '0.0.0.0 (All Interfaces)';
            allOpt.title = '0.0.0.0 (All Interfaces)';
            selectEl.appendChild(allOpt);
            
            let defaultBindIp = '0.0.0.0';
            let savedSubnet = '';
            if (savedIp) {
                const parts = savedIp.split('.');
                if (parts.length === 4) {
                    savedSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.`;
                }
            }
            
            ips.forEach(adapterStr => {
                const adapterIp = adapterStr.split(' - ')[0];
                const opt = document.createElement('option');
                opt.value = adapterIp;
                opt.textContent = adapterStr;
                opt.title = adapterStr;
                selectEl.appendChild(opt);
                
                if (savedSubnet && adapterIp.startsWith(savedSubnet)) {
                    defaultBindIp = adapterIp;
                }
            });
            
            selectEl.value = defaultBindIp;
            
            // Set tooltip on select element itself for the currently selected item
            const updateSelectTooltip = () => {
                const selectedOpt = selectEl.options[selectEl.selectedIndex];
                if (selectedOpt) selectEl.title = selectedOpt.textContent;
            };
            updateSelectTooltip();
            
            selectEl.addEventListener('change', (e) => {
                updateSelectTooltip();
                const newIp = e.target.value;
                if (isMonitoring) {
                    pyBridge.artnet_stop(() => {
                        startMonitoring(newIp);
                    });
                } else {
                    startMonitoring(newIp);
                }
            });
            
            startMonitoring(defaultBindIp);
        });
    });
}

function startMonitoring(bindIp = '0.0.0.0') {
    if (!pyBridge) return;
    pyBridge.artnet_start(bindIp, function(resStr) {
        const res = JSON.parse(resStr);
        if (!res.success) {
            showToast("Failed to start: " + res.error, "error");
            return;
        }
        isMonitoring = true;
        canvas.style.display = 'block';
        
        if (!animationFrameId) {
            drawLoop();
        }
    });
}

function pollNetwork() {
    if (!pyBridge) return;

    if (!isMonitoring) {
        const selectEl = document.getElementById('network-adapter');
        const bindIp = selectEl ? selectEl.value : '0.0.0.0';
        pyBridge.artnet_start(bindIp, function(resStr) {
            const res = JSON.parse(resStr);
            if (!res.success) {
                showToast("Failed to start: " + res.error, "error");
                return;
            }
            isMonitoring = true;
            canvas.style.display = 'block';
            if (!animationFrameId) drawLoop();

            sendArtPoll();
        });
    } else {
        sendArtPoll();
    }
}

function sendArtPoll() {
    pyBridge.artnet_poll(function(){});
}

// Auto-poll every 10 seconds to keep node list fresh and prevent timeouts
setInterval(() => {
    if (isMonitoring && !document.hidden && pyBridge) {
        sendArtPoll();
    }
}, 10000);

function drawLoop() {
    if (isMonitoring) {
        if (canvasNeedsRender) {
            renderCanvas();
            canvasNeedsRender = false;
        }
        animationFrameId = requestAnimationFrame(drawLoop);
    } else {
        animationFrameId = null;
    }
}

function renderCanvas() {
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const uniId = getSelectedUniverseId();
    const data = universeBuffer.get(uniId);
    
    const MIN_CELL_FOR_LABELS = 24;
    const fontSize = Math.max(8, Math.min(13, Math.floor(cellSize * 0.32)));
    const showLabels = cellSize >= MIN_CELL_FOR_LABELS;

    if (!data) {
        // Draw empty grid
        for (let i = 0; i < 512; i++) {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const x = col * cellSize;
            const y = row * cellSize;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
            
            if (showLabels) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.font = `${fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((i + 1).toString(), x + cellSize / 2, y + cellSize / 2);
            }
            
            if (i === hoveredChannelIdx) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
            }
        }
    } else {
        for (let i = 0; i < 512; i++) {
            const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        const val = data[i] || 0;
        
        const x = col * cellSize;
        const y = row * cellSize;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

        const intensity = val / 255;
        if (val > 0) {
            const displayIntensity = Math.max(intensity, 0.18);
            ctx.fillStyle = `rgba(253, 216, 53, ${displayIntensity})`;
            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        }
        
        if (showLabels) {
            ctx.fillStyle = intensity > 0.6 ? '#000' : (val > 0 ? '#fff' : 'rgba(255, 255, 255, 0.2)');
            ctx.font = `${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((i + 1).toString(), x + cellSize / 2, y + cellSize / 2);
        }
        
        if (i === hoveredChannelIdx) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        }
    }
    } // <-- Close else block

    // Show HTML "NO SIGNAL" if selected universe is offline
    const lastSeen = universeLastSeen.get(uniId) || 0;
    const isOffline = (Date.now() - lastSeen > OFFLINE_THRESHOLD_MS);
    
    const overlay = document.getElementById('no-signal-overlay');
    if (overlay) {
        overlay.style.display = isOffline ? 'flex' : 'none';
    }
}

// ---------------------------------------------------------
// Tooltip
// ---------------------------------------------------------
function setupTooltip() {
    const tooltip = document.getElementById('fixture-tooltip');

    canvas.addEventListener('mousemove', (e) => {
        const uniId = getSelectedUniverseId();
        if (!isMonitoring || !universeBuffer.has(uniId)) {
            tooltip.classList.remove('visible');
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const x = e.offsetX;
        const y = e.offsetY;
        
        const col = Math.floor(x / cellSize);
        const row = Math.floor(y / cellSize);
        
        if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
            const channelIdx = row * GRID_COLS + col;
            
            if (channelIdx !== hoveredChannelIdx) {
                hoveredChannelIdx = channelIdx;
                canvasNeedsRender = true;
            }

            if (channelIdx < 512) {
                const data = universeBuffer.get(uniId);
                const val = data ? (data[channelIdx] || 0) : 0;
                
                tooltip.innerHTML = `
                    <div class="tooltip-title">Channel ${channelIdx + 1}</div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Value:</span>
                        <span class="tooltip-value">${val}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Intensity:</span>
                        <span class="tooltip-value">${Math.round((val/255)*100)}%</span>
                    </div>
                `;
                
                let tX = e.clientX + 15;
                let tY = e.clientY + 15;
                if (tX + 150 > window.innerWidth) tX = e.clientX - 160;
                if (tY + 80 > window.innerHeight) tY = e.clientY - 90;
                
                tooltip.style.left = tX + 'px';
                tooltip.style.top = tY + 'px';
                tooltip.classList.add('visible');
                return;
            }
        }
        tooltip.classList.remove('visible');
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
        if (hoveredChannelIdx !== -1) {
            hoveredChannelIdx = -1;
            canvasNeedsRender = true;
        }
    });
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
