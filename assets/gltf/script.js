import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/addons/controls/OrbitControls.js';
import { GLTFLoader } from '../lib/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from '../lib/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from '../lib/addons/environments/RoomEnvironment.js';

window.selectFile = selectFile;
window.unpackGLB = unpackGLB;
window.switchView = switchView;
window.filterTextures = filterTextures;
window.closeLightbox = closeLightbox;

let backend = null;
let currentFilePath = null;
let currentView = '2d';

// Suppress harmless Windows/DirectX shader compilation warnings in the terminal
const originalWarn = console.warn;
console.warn = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('THREE.WebGLProgram')) return;
    originalWarn.apply(console, args);
};

// Connect to PyQt backend
let checkInterval;
function initBridge() {
  if (typeof qt !== 'undefined' && qt.webChannelTransport) {
      new QWebChannel(qt.webChannelTransport, function (channel) {
          window.pyBridge = channel.objects.backend;
          backend = window.pyBridge;
          
          backend.progress_update.connect(function(msg) {
              log(msg);
          });
          
          backend.analyze_complete.connect(function(response) {
              handleAnalyzeResponse(response);
          });
          
          backend.unpack_complete.connect(function(response) {
              handleUnpackResponse(response);
          });
          
          backend.file_selected.connect(function(response) {
              try {
                  const res = JSON.parse(response);
                  if (res.success) {
                  currentFilePath = res.path;
                  elLblFilename.textContent = res.filename;
                  elLblFilename.title = res.path;
                  elBtnUnpack.disabled = false;
                  
                  // Load model into our custom Three.js viewer
                  load3DModel('file:///' + res.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/'));
                  
                  // Ask backend to extract textures for 2D Grid
                  loadTextures(res.path);
                  } else if (res.error !== 'Cancelled') {
                      log("Error: " + res.error);
                  }
              } catch(e) {
                  log("Error parsing response: " + e);
              }
          });
          
          log("Ready. You can drag and drop a .glb or .gltf file here!");
      });
      clearInterval(checkInterval);
  }
}
checkInterval = setInterval(initBridge, 100);
initBridge();

// Global DOM Cache
const elDragOverlay = document.getElementById('drag-overlay');
const elLightbox = document.getElementById('lightbox');
const elLightboxImg = document.getElementById('lightbox-img');
const elLightboxCaption = document.getElementById('lightbox-caption');
const elTextureSearch = document.getElementById('texture-search');
const elTextureSearchContainer = document.getElementById('texture-search-container');
const elLogOutput = document.getElementById('log-output');
const elToastContainer = document.getElementById('toast-container');
const elTab2D = document.getElementById('tab-2d');
const elTab3D = document.getElementById('tab-3d');
const elEmptyState = document.getElementById('empty-state');
const elTextureGrid = document.getElementById('texture-grid');
const elModelViewContainer = document.getElementById('model-view-container');
const elLoadingBarContainer = document.getElementById('loading-bar-container');
const elLoadingFill = document.getElementById('loading-fill');
const elLoadingText = document.getElementById('loading-text');
const elLblFilename = document.getElementById('lbl-filename');
const elBtnUnpack = document.getElementById('btn-unpack');
const elLblTextures = document.getElementById('lbl-textures');
const elLblSize = document.getElementById('lbl-size');
const elLblMeshes = document.getElementById('lbl-meshes');
const elLblMaterials = document.getElementById('lbl-materials');
const elLblAnimations = document.getElementById('lbl-animations');

let textureCardsCache = [];

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Three.js Globals
let scene, camera, renderer, controls;
let currentModel = null;
let gltfLoader = null;

// Drag Overlay Logic
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    elDragOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        elDragOverlay.classList.remove('active');
    }
});
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    elDragOverlay.classList.remove('active');
});

// Lightbox Logic
function openLightbox(name, dataUrl) {
    elLightboxImg.src = dataUrl;
    elLightboxCaption.textContent = name;
    elLightbox.classList.add('show');
}
function closeLightbox() {
    elLightbox.classList.remove('show');
}

// Search Filter
function filterTextures() {
    const query = elTextureSearch.value.toLowerCase();
    textureCardsCache.forEach(item => {
        item.el.style.display = item.name.includes(query) ? 'block' : 'none';
    });
}

function log(msg) {
    elLogOutput.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    elLogOutput.scrollTop = elLogOutput.scrollHeight;
}

function showToast(message, type = 'info', duration = 3200) {
    if (!elToastContainer) return;
    
    if (type === true) type = 'error';
    else if (message.toLowerCase().includes('success')) type = 'success';
    else if (type === false) type = 'info';

    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let escapedMessage = esc(message);
    toast.innerHTML = `<span>${icons[type] || '●'}</span><span style="margin-left: 6px;">${escapedMessage}</span>`;
    elToastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

function switchView(view) {
    currentView = view;
    elTab2D.classList.toggle('active', view === '2d');
    elTab3D.classList.toggle('active', view === '3d');
    
    if (currentFilePath) {
        elEmptyState.style.display = 'none';
        
        // Use CSS opacity transitions instead of display blocking
        elTextureGrid.classList.toggle('active', view === '2d');
        elModelViewContainer.classList.toggle('active', view === '3d');
        
        if (view === '3d' && renderer) {
            resize3D();
            if (window._animationFrameId) cancelAnimationFrame(window._animationFrameId);
            animate3D(); // restart loop
        }
    } else {
        elEmptyState.style.display = 'flex';
        elTextureGrid.classList.remove('active');
        elModelViewContainer.classList.remove('active');
    }
}

async function selectFile() {
    if (!backend) return;
    
    log("Opening file dialog...");
    backend.select_file();
}

function handleDroppedFile(path) {
    if (!backend) return;
    log(`File dropped: ${path}`);
    
    currentFilePath = path;
    const filename = path.split('/').pop();
    elLblFilename.textContent = filename;
    elLblFilename.title = path;
    elBtnUnpack.disabled = false;
    
    load3DModel('file:///' + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/'));
    
    loadTextures(path);
}

function loadTextures(path) {
    log("Requesting texture analysis (running in background thread)...");
    backend.analyze_glb(path);
}

function handleAnalyzeResponse(response) {
    try {
        const res = JSON.parse(response);
        if (res.success) {
        elLblTextures.textContent = res.texture_count;
        if (res.stats) {
            elLblSize.textContent = res.stats.size_mb + ' MB';
            elLblMeshes.textContent = res.stats.meshes;
            elLblMaterials.textContent = res.stats.materials;
            elLblAnimations.textContent = res.stats.animations;
        }
        
        elTextureSearchContainer.style.display = 'block';
        elTextureSearch.value = '';
            
        elTextureGrid.innerHTML = '';
        textureCardsCache = []; // Reset the in-memory cache
        
        if (res.texture_count === 0) {
            elTextureGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 40px;">No textures found in this model.</div>';
        } else {
            // Batch DOM insertions using a DocumentFragment
            const fragment = document.createDocumentFragment();
            
            res.textures.forEach(tex => {
                const card = document.createElement('div');
                card.className = 'texture-card';
                card.setAttribute('data-name', tex.name);
                
                const badgeHtml = tex.resolution ? `<div class="texture-badge">${esc(tex.resolution)}</div>` : '';
                
                card.innerHTML = `
                    <div class="texture-preview">
                        ${badgeHtml}
                        <div class="texture-download-btn" title="Quick Save">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        </div>
                        <img src="${esc(tex.data_url)}" alt="${esc(tex.name)}" loading="lazy">
                    </div>
                    <div class="texture-info">
                        <div class="texture-name" title="${esc(tex.name)}">${esc(tex.name)}</div>
                        <div class="texture-idx">Index: ${esc(tex.index)}</div>
                    </div>
                `;
                
                const previewDiv = card.querySelector('.texture-preview');
                const downloadBtn = card.querySelector('.texture-download-btn');
                
                previewDiv.addEventListener('click', () => {
                    openLightbox(tex.name, tex.data_url);
                });
                
                downloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    downloadTexture(tex.index, tex.name, tex.data_url);
                });
                
                fragment.appendChild(card);
                textureCardsCache.push({ el: card, name: tex.name.toLowerCase() });
            });
            
            elTextureGrid.appendChild(fragment);
        }
        
        // Ensure UI is showing the selected view
        switchView(currentView);
        showToast("File loaded successfully");
    } else {
        log(`Error analyzing model: ${res.error}`);
        showToast("Failed to load model", true);
    }
    } catch(e) { log("Error parsing analyze response."); }
}

function unpackGLB() {
    if (!backend || !currentFilePath) return;
    
    elBtnUnpack.disabled = true;
    log("Starting unpack process (running in background thread)...");
    
    backend.unpack_glb(currentFilePath);
    
    if (window._unpackTimeout) clearTimeout(window._unpackTimeout);
    window._unpackTimeout = setTimeout(() => {
        if (elBtnUnpack.disabled) {
            elBtnUnpack.disabled = false;
            showToast("Unpack operation timed out", true);
            log("Error: Unpack operation timed out after 60 seconds.");
        }
    }, 60000);
}

function handleUnpackResponse(response) {
    if (window._unpackTimeout) clearTimeout(window._unpackTimeout);
    try {
        const res = JSON.parse(response);
        if (res.success) {
            showToast("Unpack completed successfully!");
            log(res.message);
        } else {
            showToast("Failed to unpack model", true);
            log(`Unpack Error: ${res.error}`);
        }
    } catch(e) { log("Error parsing unpack response."); }
    elBtnUnpack.disabled = false;
}

function downloadTexture(index, name, dataUrl) {
    if (!backend || !currentFilePath) return;
    showToast(`Saving ${name}...`);
    backend.save_single_texture(currentFilePath, index, dataUrl, name);
}

// --- 3D Viewer Logic ---
function init3DViewer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x161616);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 2, 5);

    // Disabled logarithmicDepthBuffer (it disables Early-Z culling, causing massive GPU lag when zoomed in)
    // Anti-aliasing must be enabled to prevent Qt WebEngine compositor glitches on Windows
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    
    // Cap native pixel ratio to 2 to maintain high framerate on 4K/Retina displays
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    renderer.outputColorSpace = THREE.SRGBColorSpace; // Crucial for accurate colors
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    elModelViewContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;
    controls.minDistance = 0.5; // Prevent camera singularity/flipping when zooming too close

    // Physically-Based Environment Lighting (Replaces basic lights)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;

    gltfLoader = new GLTFLoader();
    
    // Support Draco compressed models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('../lib/addons/libs/draco/');
    gltfLoader.setDRACOLoader(dracoLoader);

    window.addEventListener('resize', resize3D);
    
    // Idle Timer (Smooth camera reset after 5s)
    let idleTimer = null;
    const defaultCameraPos = new THREE.Vector3(0, 2, 5);
    const defaultTarget = new THREE.Vector3(0, 0, 0);
    const defaultSpherical = new THREE.Spherical().setFromVector3(defaultCameraPos.clone().sub(defaultTarget));

    window._idleResetState = {
        isResetting: false,
        defaultTarget: defaultTarget,
        defaultSpherical: defaultSpherical
    };

    let isMouseDown = false;

    window.addEventListener('mousedown', () => {
        isMouseDown = true;
        if (controls) controls.autoRotate = false;
        resetIdleTimer();
    });
    window.addEventListener('mouseup', () => {
        isMouseDown = false;
        if (controls) controls.autoRotate = true;
        resetIdleTimer();
    });
    window.addEventListener('mouseleave', () => {
        isMouseDown = false;
        if (controls) controls.autoRotate = true;
        resetIdleTimer();
    });

    function resetCamera() {
        if (isMouseDown) return; // Do not trigger reset while user is holding the mouse
        if (controls && currentView === '3d') {
            window._idleResetState.isResetting = true;
        }
    }
    function resetIdleTimer() {
        if (window._idleResetState.isResetting) {
            window._idleResetState.isResetting = false;
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(resetCamera, 5000);
    }
    
    // Ensure resetting timer works on interactions
    document.body.addEventListener('mousemove', resetIdleTimer);
    document.body.addEventListener('wheel', resetIdleTimer);
    document.body.addEventListener('touchstart', () => {
        isMouseDown = true;
        if (controls) controls.autoRotate = false;
        resetIdleTimer();
    });
    document.body.addEventListener('touchend', () => {
        isMouseDown = false;
        if (controls) controls.autoRotate = true;
        resetIdleTimer();
    });
    document.body.addEventListener('touchmove', resetIdleTimer);
    
    resetIdleTimer();
    
    animate3D();
}

function resize3D() {
    if (!renderer || currentView !== '3d') return;
    const width = elModelViewContainer.clientWidth;
    const height = elModelViewContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, true);
}

function animate3D() {
    if (currentView !== '3d') return; // Stop loop when inactive
    if (window._animationFrameId) cancelAnimationFrame(window._animationFrameId);
    window._animationFrameId = requestAnimationFrame(animate3D);
    if (currentView === '3d') {
        // Handle smooth reset lerping for Pan and Zoom only (leave rotation untouched)
        if (window._idleResetState && window._idleResetState.isResetting) {
            const state = window._idleResetState;
            
            // Lerp target to (0,0,0)
            controls.target.lerp(state.defaultTarget, 0.05);
            
            // Convert current camera position to spherical relative to CURRENT target
            const offset = camera.position.clone().sub(controls.target);
            const currentSpherical = new THREE.Spherical().setFromVector3(offset);
            
            // Lerp radius (zoom) and phi (pitch) to defaults
            currentSpherical.radius += (state.defaultSpherical.radius - currentSpherical.radius) * 0.05;
            currentSpherical.phi += (state.defaultSpherical.phi - currentSpherical.phi) * 0.05;
            // DO NOT touch currentSpherical.theta (rotation)!
            
            // Apply spherical coordinates back to camera position
            offset.setFromSpherical(currentSpherical);
            camera.position.copy(controls.target).add(offset);
            
            // Check if close enough to snap and stop
            if (Math.abs(currentSpherical.radius - state.defaultSpherical.radius) < 0.01 && 
                Math.abs(currentSpherical.phi - state.defaultSpherical.phi) < 0.01 &&
                controls.target.distanceTo(state.defaultTarget) < 0.01) {
                
                controls.target.copy(state.defaultTarget);
                
                currentSpherical.radius = state.defaultSpherical.radius;
                currentSpherical.phi = state.defaultSpherical.phi;
                offset.setFromSpherical(currentSpherical);
                camera.position.copy(controls.target).add(offset);
                
                state.isResetting = false;
            }
        }
        
        controls.update();
        renderer.render(scene, camera);
    }
}

function disposeNode(node) {
    if (node.geometry) {
        node.geometry.dispose();
    }
    if (node.material) {
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
}

function load3DModel(url) {
    if (currentModel) {
        currentModel.traverse(disposeNode);
        scene.remove(currentModel);
        currentModel = null;
    }
    
    elLoadingBarContainer.style.display = 'block';
    elLoadingFill.style.width = '0%';
    elLoadingText.textContent = 'Loading Model...';
    
    gltfLoader.load(
        url,
        function (gltf) {
            currentModel = gltf.scene;
            
            // Center and scale model roughly to fit in view
            const box = new THREE.Box3().setFromObject(currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 3 / maxDim;
            currentModel.scale.setScalar(scale);
            
            currentModel.position.sub(center.multiplyScalar(scale));
            
            scene.add(currentModel);
            elLoadingBarContainer.style.display = 'none';
        },
        function (xhr) {
            if (xhr.lengthComputable) {
                const percentComplete = (xhr.loaded / xhr.total) * 100;
                elLoadingFill.style.width = percentComplete + '%';
                elLoadingText.textContent = `Loading... ${Math.round(percentComplete)}%`;
            } else {
                elLoadingText.textContent = `Loading... ${(xhr.loaded / 1024 / 1024).toFixed(2)} MB`;
            }
        },
        function (error) {
            console.error(error);
            elLoadingBarContainer.style.display = 'none';
            showToast("Error loading 3D model", true);
        }
    );
}

// Boot up the 3D engine on startup
init3DViewer();
