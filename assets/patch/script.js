let fixtures = [];
let currentSortColumn = 'id';
let sortAscending = true;
let pyBridge = null;
let fixtureSpecs = [];

function getSpecsForType(typeName) {
    let typeUpper = typeName.toUpperCase();
    for (let spec of fixtureSpecs) {
        if (typeUpper.includes(spec.name.toUpperCase()) && typeUpper.includes(spec.mode.toUpperCase())) {
            return { watt: spec.watt, weight: spec.weight };
        }
    }
    for (let spec of fixtureSpecs) {
        if (typeUpper.includes(spec.name.toUpperCase())) {
            return { watt: spec.watt, weight: spec.weight };
        }
    }
    return { watt: 0, weight: 0 };
}

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
            if (pyBridge.patch_pulled) {
                pyBridge.patch_pulled.connect(function(patchResStr) {
                    hideLoadingOverlay();
                    try {
                        let response = JSON.parse(patchResStr);
                        if (response.success) {
                            parsePatchXML(response.data);
                            if (response.showName) {
                                let fnInput = document.getElementById('export-filename');
                                if (fnInput) fnInput.value = response.showName;
                            }
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
            if (pyBridge.pdf_exported) {
                pyBridge.pdf_exported.connect(function(resStr) {
                    hideLoadingOverlay();
                    try {
                        let response = JSON.parse(resStr);
                        if(response.success) showToast("PDF Saved to: " + response.path, "success");
                        else showToast("Export Failed: " + response.error, "error");
                    } catch(e) { showToast("Error parsing export response", "error"); }
                });
            }
            if (pyBridge.get_fixture_specs) {
                pyBridge.get_fixture_specs(function(resStr) {
                    try {
                        fixtureSpecs = JSON.parse(resStr) || [];
                    } catch(e) {
                        console.error("Error parsing fixture specs:", e);
                        fixtureSpecs = []; 
                    }
                });
            }
        });
        clearInterval(checkInterval);
    }
}
checkInterval = setInterval(initBridge, 100);
initBridge();
});

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

// Fungsi untuk memunculkan notifikasi Toast
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container'); 
    if (!container) return;
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

// Fungsi helper untuk sanitize string ke HTML
function escXML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Fungsi untuk mereset/membersihkan list patch
function clearPatchList() {
    if (fixtures.length === 0) {
        showToast("Patch list is already empty.", "info");
        return;
    }
    fixtures = [];
    document.getElementById('fixture-count').textContent = '0';
    if(document.getElementById('total-watt')) document.getElementById('total-watt').textContent = '0';
    if(document.getElementById('total-weight')) document.getElementById('total-weight').textContent = '0';
    document.getElementById('search-fixtures').value = '';
    renderTable();
    showToast("Patch list cleared. Ready for a new patch!", "success");
}

// Fungsi untuk mengimpor file XML dari penyimpanan lokal (Native)
function importPatchXMLNative() {
    if(!pyBridge) return showToast("Bridge not ready", "error");
    pyBridge.import_patch(function(resStr) {
        let response = JSON.parse(resStr);
        if (!response.success) { if (response.error !== "Cancelled") showToast("Error: " + response.error, "error"); return; }
        if (response.showName) {
            let fnInput = document.getElementById('export-filename');
            if (fnInput) fnInput.value = response.showName;
        }
        parsePatchXML(response.data);
    });
}

// Fungsi untuk menarik data patch langsung via Telnet grandma2
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
        ip: document.getElementById('login-ip').value.split(' ')[0].trim() || "127.0.0.1",
        user: document.getElementById('login-user').value || "administrator",
        password: document.getElementById('login-pass').value || "admin"
    };
    let loginStr = JSON.stringify(creds);
    
    updateLoadingOverlay("Connecting to MA2 for Patch...");
    pyBridge.pull_patch(loginStr);
}

// 1. UPDATE FUNGSI parsePatchXML
function parsePatchXML(xmlString) {
    try {
        const parser = new DOMParser(); 
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");
        const layers = xmlDoc.querySelectorAll('Layer'); 
        
        fixtures = []; 
        let layerIndexCounter = 1;

        // Kumpulkan semua data tanpa memberi nomor Unit terlebih dahulu
        if (layers.length === 0) {
            const fallbackNodes = xmlDoc.querySelectorAll('Fixture');
            fallbackNodes.forEach(n => processFixtureNode(n, 1, "Default Layer"));
        } else {
            layers.forEach(layerNode => {
                let layerName = layerNode.getAttribute('name') || "Unknown Layer";
                let layerIndexRaw = layerNode.getAttribute('index');
                let layerIndex = layerIndexRaw !== null ? (parseInt(layerIndexRaw) + 1) : layerIndexCounter;
                
                const nodes = layerNode.querySelectorAll('Fixture'); 
                nodes.forEach(n => processFixtureNode(n, layerIndex, layerName));
                layerIndexCounter++;
            });
        }
        
        // --- LOGIKA PERBAIKAN UNIT ---
        // A. Urutkan semua data berdasarkan Fixture ID / Channel ID terkecil
        fixtures.sort((a, b) => a.id - b.id);

        // B. Berikan nomor Unit secara berurutan per tipe lampu
        let unitCounters = {};
        let totalWatt = 0;
        let totalWeight = 0;
        fixtures.forEach(f => {
            unitCounters[f.type] = (unitCounters[f.type] || 0) + 1;
            f.unit = unitCounters[f.type];
            totalWatt += (f.watt || 0);
            totalWeight += (f.weight || 0);
        });
        
        document.getElementById('fixture-count').textContent = `${fixtures.length}`;
        if (document.getElementById('total-watt')) document.getElementById('total-watt').textContent = `${totalWatt.toLocaleString('en-US')}`;
        if (document.getElementById('total-weight')) document.getElementById('total-weight').textContent = `${totalWeight.toLocaleString('en-US')}`;
        
        // C. Terapkan sorting tabel sesuai dengan yang sedang aktif (misal user sedang sort by Patch)
        applyCurrentSort();
        
    } catch(err) { 
        showToast("XML Parse Error", "error"); 
        console.error(err);
    }
}

// 2. UPDATE FUNGSI processFixtureNode (Hapus parameter unitCounters)
function processFixtureNode(n, layerIndex, layerName) {
    let rawFid = parseInt(n.getAttribute('fixture_id') || "0");
    let rawCid = parseInt(n.getAttribute('channel_id') || "0");
    
    let displayId = "";
    let sortId = 0;
    
    if (rawFid !== 0) {
        displayId = "#" + rawFid;
        sortId = rawFid;
    } else if (rawCid !== 0) {
        displayId = String(rawCid);
        sortId = rawCid;
    } else {
        return; 
    }
    let name = n.getAttribute('name') || "Unknown";
    
    let type = "Standard";
    let typeNode = n.querySelector('FixtureType');
    if (typeNode) {
        type = typeNode.getAttribute('name') || type;
        if (/^\d+\s+(.*)/.test(type)) type = type.match(/^\d+\s+(.*)/)[1];
    }
    
    let specs = getSpecsForType(type);
    let watt = specs.watt;
    let weight = specs.weight;

    let patch = "Unpatched";
    const addressNode = n.querySelector('SubFixture Patch Address');
    if (addressNode) {
        let absoluteAddr = parseInt(addressNode.textContent.trim());
        if (!isNaN(absoluteAddr)) {
            let universe = Math.floor((absoluteAddr - 1) / 512) + 1;
            let relativeAddr = ((absoluteAddr - 1) % 512) + 1;
            let formattedAddr = String(relativeAddr).padStart(3, '0');
            patch = universe + "." + formattedAddr;
        }
    }

    // Set nilai unit ke 0 sementara, nanti akan diisi secara otomatis setelah diurutkan
    fixtures.push({ layerIndex, layerName, unit: 0, displayId, id: sortId, name, type, patch, watt, weight });
}

// 3. TAMBAHKAN FUNGSI BARU applyCurrentSort (Agar urutan tidak acak saat update)
function applyCurrentSort() {
    fixtures.sort((a, b) => {
        let valA = a[currentSortColumn];
        let valB = b[currentSortColumn];

        if (currentSortColumn === 'id' || currentSortColumn === 'unit') {
            return sortAscending ? valA - valB : valB - valA;
        } else if (currentSortColumn === 'patch') {
            if (valA === "Unpatched" && valB !== "Unpatched") return sortAscending ? 1 : -1;
            if (valB === "Unpatched" && valA !== "Unpatched") return sortAscending ? -1 : 1;
            if (valA === "Unpatched" && valB === "Unpatched") return 0;
            
            let pA = valA.split('.').map(Number);
            let pB = valB.split('.').map(Number);
            
            if (pA[0] !== pB[0]) return sortAscending ? pA[0] - pB[0] : pB[0] - pA[0];
            return sortAscending ? (pA[1] || 0) - (pB[1] || 0) : (pB[1] || 0) - (pA[1] || 0);
        } else {
            return sortAscending ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
        }
    });

    renderTable();
}

// 4. UPDATE FUNGSI sortBy (Dipersingkat agar memanggil applyCurrentSort)
function sortBy(column) {
    if (currentSortColumn === column) {
        sortAscending = !sortAscending;
    } else {
        currentSortColumn = column;
        sortAscending = true;
    }

    document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '↕');
    
    let sortEl = document.getElementById(`sort-${column}`);
    if (sortEl) sortEl.textContent = sortAscending ? '↓' : '↑';

    applyCurrentSort(); // <-- Gunakan helper baru ini
}

function handleSearch() {
    renderTable();
}

// Menampilkan data patch ke dalam tabel UI HTML aplikasi
function renderTable() {
    const tbody = document.getElementById('table-body');
    const emptyState = document.getElementById('empty-state');
    const patchTable = document.getElementById('patch-table');
    
    tbody.innerHTML = '';
    const term = document.getElementById('search-fixtures').value.toLowerCase();

    if (fixtures.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        if (patchTable) patchTable.style.display = 'none';
        return;
    } else {
        if (emptyState) emptyState.style.display = 'none';
        if (patchTable) patchTable.style.display = 'table';
    }

    fixtures.forEach(f => {
        if (term && !String(f.id).toLowerCase().includes(term) && !f.name.toLowerCase().includes(term) && !f.patch.toLowerCase().includes(term)) {
            return;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.unit}</td>
            <td><strong>${escXML(f.displayId)}</strong></td>
            <td>${escXML(f.name)}</td>
            <td><span class="type-badge">${escXML(f.type)}</span></td>
            <td><code>${escXML(f.patch)}</code></td>
        `;
        tbody.appendChild(tr);
    });
}

function openPDFModal() {
    if (fixtures.length === 0) return showToast("No data to export!", "error");
    
    // Populate layers list
    let layerSet = new Set();
    fixtures.forEach(f => layerSet.add(f.layerName));
    let layerArray = Array.from(layerSet).sort();
    
    let listContainer = document.getElementById('layer-exclusion-list');
    listContainer.innerHTML = '';
    
    if (layerArray.length === 0) {
        listContainer.innerHTML = '<span style="font-size:12px; color:#666;">No layers found</span>';
    } else {
        layerArray.forEach(layer => {
            let div = document.createElement('div');
            div.style = "display: flex; align-items: center; gap: 8px;";
            
            let cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true; // Default included
            cb.value = layer;
            cb.className = 'layer-export-cb';
            cb.style = "width: 14px; height: 14px; cursor: pointer;";
            
            let id = 'layer-cb-' + layer.replace(/[^a-zA-Z0-9]/g, '-');
            cb.id = id;
            
            let label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = layer || "(No Layer)";
            label.style = "font-size: 13px; color: #eee; cursor: pointer; user-select: none;";
            
            div.appendChild(cb);
            div.appendChild(label);
            listContainer.appendChild(div);
        });
    }

    openModal('export-pdf-modal');
}

// Helper to load image as base64
function getBase64Image(url) {
    return new Promise((resolve, reject) => {
        let img = new Image();
        img.onload = () => {
            let canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            let ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = reject;
        img.src = url;
    });
}

// FUNGSI UTAMA EXPORT PDF
async function submitPDFExport(layoutMode) {
    let separatePages = document.getElementById('page-break-checkbox').checked;
    let useWatermark = document.getElementById('watermark-checkbox').checked;
    closeModal('export-pdf-modal');
    
    let exportFilename = document.getElementById('export-filename').value.trim() || "MA2_PATCH_LIST";
    
    // Determine included layers
    let includedLayers = new Set();
    document.querySelectorAll('.layer-export-cb:checked').forEach(cb => {
        includedLayers.add(cb.value);
    });
    
    let filteredFixtures = fixtures.filter(f => includedLayers.has(f.layerName));
    if (filteredFixtures.length === 0) {
        showToast("No fixtures in selected layers to export.", "error");
        return;
    }
    
    let totalFixtures = filteredFixtures.length;
    let pdfTotalWatt = 0;
    let pdfTotalWeight = 0;
    filteredFixtures.forEach(f => {
        pdfTotalWatt += (f.watt || 0);
        pdfTotalWeight += (f.weight || 0);
    });

    // Group fixtures by layer
    let layersMap = new Map();
    filteredFixtures.forEach(f => {
        if (!layersMap.has(f.layerName)) {
            layersMap.set(f.layerName, []);
        }
        layersMap.get(f.layerName).push(f);
    });

    // Convert to array and sort layers by their smallest fixture ID
    let layersArray = Array.from(layersMap.entries());
    layersArray.sort((layerA, layerB) => {
        let minIdA = Math.min(...layerA[1].map(f => f.id));
        let minIdB = Math.min(...layerB[1].map(f => f.id));
        return minIdA - minIdB;
    });

    // Sort fixtures within each layer by ID
    layersArray.forEach(layer => {
        layer[1].sort((a, b) => a.id - b.id);
    });

    let watermarkCSS = "";
    let watermarkHTML = "";
    if (useWatermark) {
        try {
            updateLoadingOverlay("Preparing watermark...");
            let watermarkBase64 = await getBase64Image('watermark.png');
            watermarkCSS = `
            .watermark-bg {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 60%;
                height: 60%;
                background-image: url('${watermarkBase64}');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                opacity: 0.05; /* tipis banget */
                z-index: -100;
            }`;
            watermarkHTML = `<div class="watermark-bg"></div>`;
        } catch (e) {
            console.warn("Watermark logo not found or failed to load.", e);
        }
    }

    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Patch List</title>
        <style>
            ${watermarkCSS}
            @page {
                size: ${layoutMode === 'a5-2up' ? 'A5 landscape' : (layoutMode === 'landscape' ? 'A4 landscape' : 'A4 portrait')};
                margin: ${layoutMode === 'a5-2up' ? '8mm 6mm' : '15mm 10mm'};
            }
            body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 12px; margin: 0; padding: 0; }
            .main-table { width: 100%; border-collapse: collapse; border: none; }
            .main-table > thead > tr > td, .main-table > tbody > tr > td { padding: 0; border: none; }
            .layer-table { border-collapse: collapse; width: 100%; margin-bottom: 25px; }
            .layer-table th { background-color: #333333; color: #ffffff; padding: ${layoutMode === 'a5-2up' ? '6px 6px' : '8px 6px'}; text-align: left; border-right: 1px solid #555; }
            .layer-table th:last-child { border-right: none; }
            .layer-table td { padding: ${layoutMode === 'a5-2up' ? '6px 6px' : '8px 6px'}; color: #000; border-bottom: 1px solid #ccc; }
            .layer-container { 
                page-break-before: ${separatePages ? 'always' : 'auto'}; 
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .layer-container:first-of-type { page-break-before: avoid; }
            thead { display: table-header-group; break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
            tr { page-break-inside: avoid; }
        </style>
    </head>
    <body>
        ${watermarkHTML}`;
        
    let mainHeaderPadding = layoutMode === 'a5-2up' ? '8px' : '10px';
    let mainHeaderMargin = layoutMode === 'a5-2up' ? '12px' : '20px';

    htmlContent += `
        <table class="main-table">
            <thead>
                <tr>
                    <td>
                        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #ddd; padding-bottom: ${mainHeaderPadding}; margin-bottom: ${mainHeaderMargin};">
                            <div style="flex: 1; padding-right: 15px; line-height: 1.4; text-align: left;">
                                <div style="margin-bottom: 2px;">Fixture Patch List</div>
                                <strong style="color: #000; font-size: 12px;">${exportFilename}</strong>
                            </div>
                            <div style="display: flex; gap: 25px; text-align: right; white-space: nowrap; line-height: 1.4;">
                                <div>
                                    <div style="margin-bottom: 2px;">Total Watt</div>
                                    <strong style="color: #000; font-size: 12px;">${pdfTotalWatt.toLocaleString('en-US')} W</strong>
                                </div>
                                <div>
                                    <div style="margin-bottom: 2px;">Total Weight</div>
                                    <strong style="color: #000; font-size: 12px;">${pdfTotalWeight.toLocaleString('en-US')} kg</strong>
                                </div>
                                <div>
                                    <div style="margin-bottom: 2px;">Total Fixtures</div>
                                    <strong style="color: #000; font-size: 12px;">${totalFixtures}</strong>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>`;
    
    layersArray.forEach(([layerName, layerFixtures]) => {
        let maxRows = layoutMode === 'a5-2up' ? 13 : 35;
        let totalPages = Math.ceil(layerFixtures.length / maxRows);
        let rowsPerPage = Math.ceil(layerFixtures.length / totalPages);

        let chunks = [];
        for (let i = 0; i < layerFixtures.length; i += rowsPerPage) {
            chunks.push(layerFixtures.slice(i, i + rowsPerPage));
        }

        chunks.forEach((chunk, chunkIndex) => {
            let isContinued = chunkIndex > 0 ? " (Cont.)" : "";
            let breakBefore = chunkIndex > 0 ? "page-break-before: always;" : "";
            let headerPadding = layoutMode === 'a5-2up' ? "padding: 8px 0px 4px 0px;" : "padding: 15px 0px 8px 0px;";

            htmlContent += `
            <div class="layer-container" style="${breakBefore}">
                <table class="layer-table">
                    <thead>
                        <tr>
                            <th colspan="5" style="background-color: transparent; ${headerPadding}; border-bottom: none; border-right: none;">
                                <div style="font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #000000; text-align: left;">${escXML(layerName)}${isContinued}</div>
                            </th>
                        </tr>
                        <tr>
                            <th width="8%">Unit</th>
                            <th width="12%">Fixture ID</th>
                            <th width="30%">Name</th>
                            <th width="35%">Type</th>
                            <th width="15%">Patch</th>
                        </tr>
                    </thead>
                    <tbody>`;
                
            chunk.forEach((f, fIndex) => {
                let rowBgColor = (fIndex % 2 === 0) ? "transparent" : "rgba(0, 0, 0, 0.04)";
                let avoidBreak = (fIndex < 3 && fIndex < chunk.length - 1) ? "page-break-after: avoid; break-after: avoid;" : "";

                htmlContent += `
                        <tr style="background-color: ${rowBgColor}; ${avoidBreak}">
                            <td>${f.unit}</td>
                            <td style="font-weight: bold;">${escXML(f.displayId)}</td>
                            <td>${escXML(f.name)}</td>
                            <td>${escXML(f.type)}</td>
                            <td>${escXML(f.patch)}</td>
                        </tr>`;
            });

            htmlContent += `
                    </tbody>
                </table>
            </div>`;
        });
    });

    htmlContent += `
                    </td>
                </tr>
            </tbody>
        </table>
    </body>
    </html>`;

    if(pyBridge) {
        updateLoadingOverlay("Processing PDF Export...");
        pyBridge.export_pdf(htmlContent, exportFilename, layoutMode, function(resStr) {
            let response = JSON.parse(resStr);
            if(response.success) {
                if (response.status === "started") {
                    updateLoadingOverlay("Generating PDF...");
                } else if (response.path) {
                    hideLoadingOverlay();
                    showToast("PDF Saved to: " + response.path, "success");
                }
            } else {
                hideLoadingOverlay();
                if (response.error !== "Cancelled") showToast("Export Failed: " + response.error, "error");
            }
        });
    }
}