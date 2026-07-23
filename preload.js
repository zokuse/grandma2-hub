const { contextBridge, ipcRenderer } = require('electron');
const pkg = require('./package.json');

let instanceCounter = 0;

// Track the most recent invoker PER CHANNEL
const activeRequesterByChannel = {};

const signalCallbacks = {
    file_selected: [], layout_pulled: [], macros_sent: [], patch_pulled: [],
    pdf_exported: [], progress_update: [], analyze_complete: [], unpack_complete: [],
    artnet_universe_data: [], artnet_node_update: [], artnet_error: []
};

// Map each signal channel back to the invoke channel(s) that trigger it
const signalToInvokeMap = {
    file_selected: ['select_file'],
    layout_pulled: ['pull_layout'],
    macros_sent: ['send_xyz_macro', 'export_macros'],
    patch_pulled: ['pull_patch'],
    pdf_exported: ['export_pdf'],
    analyze_complete: ['analyze_glb'],
    unpack_complete: ['unpack_glb'],
    progress_update: ['pull_layout', 'pull_patch', 'send_xyz_macro', 'export_macros', 'analyze_glb', 'unpack_glb'],
    artnet_universe_data: ['artnet_start'],
    artnet_node_update: ['artnet_start'],
    artnet_error: ['artnet_start']
};

// Register ONE listener per channel, broadcasting to all registered callbacks
Object.keys(signalCallbacks).forEach(channel => {
    ipcRenderer.on(channel, (e, ...args) => {
        signalCallbacks[channel] = signalCallbacks[channel].filter(obj => !obj.dead);
        signalCallbacks[channel].forEach(obj => {
            let matches = false;
            if (signalToInvokeMap[channel]) {
                matches = signalToInvokeMap[channel].some(invokeCh => activeRequesterByChannel[invokeCh] === obj.myId);
            }
            if (matches) {
                try { obj.cb(...args); } catch (err) { obj.dead = true; }
            }
        });
    });
});

function buildBridgeAPI() {
    const myId = ++instanceCounter;
    const registeredChannels = []; // for cleanup on unload

    function makeInvoke(channel) {
        return (...args) => {
            activeRequesterByChannel[channel] = myId;
            let cb = null;
            if (args.length > 0 && typeof args[args.length - 1] === 'function') {
                cb = args.pop();
            }
            return ipcRenderer.invoke(channel, ...args).then(res => {
                if (cb) cb(res);
                return res;
            }).catch(err => {
                console.error('IPC Error on ' + channel + ':', err);
            });
        };
    }

    function makeSignal(channel) {
        registeredChannels.push(channel);
        return {
            connect: (cb) => signalCallbacks[channel].push({ myId, cb, dead: false }),
            disconnect: (cb) => {
                signalCallbacks[channel] = signalCallbacks[channel]
                    .filter(obj => obj.myId !== myId || obj.cb !== cb);
            }
        };
    }

    const api = {
        clear_credentials: makeInvoke('clear_credentials'),
        export_macros: makeInvoke('export_macros'),
        export_pdf: makeInvoke('export_pdf'),
        get_dmx_dict: makeInvoke('get_dmx_dict'),
        save_dmx_dict: makeInvoke('save_dmx_dict'),
        get_fixture_specs: makeInvoke('get_fixture_specs'),
        save_fixture_specs: makeInvoke('save_fixture_specs'),
        get_local_ips: makeInvoke('get_local_ips'),
        get_saved_credentials: makeInvoke('get_saved_credentials'),
        import_capture_xml: makeInvoke('import_capture_xml'),
        import_layout: makeInvoke('import_layout'),
        import_patch: makeInvoke('import_patch'),
        parse_capture_xml: makeInvoke('parse_capture_xml'),
        parse_ma2_patch: makeInvoke('parse_ma2_patch'),
        pull_layout: makeInvoke('pull_layout'),
        pull_patch: makeInvoke('pull_patch'),
        save_global_credentials: makeInvoke('save_global_credentials'),
        send_to_console: makeInvoke('send_to_console'),
        send_xyz_macro: makeInvoke('send_xyz_macro'),
        send_timecode_to_ma2: makeInvoke('send_timecode_to_ma2'),
        select_file: makeInvoke('select_file'),
        analyze_glb: makeInvoke('analyze_glb'),
        unpack_glb: makeInvoke('unpack_glb'),
        save_single_texture: makeInvoke('save_single_texture'),
        artnet_start: makeInvoke('artnet_start'),
        artnet_stop: makeInvoke('artnet_stop'),
        artnet_poll: makeInvoke('artnet_poll'),
        artnet_get_active_universes: makeInvoke('artnet_get_active_universes'),

        switch_to: (toolId) => {
            ipcRenderer.send('switch-tab', toolId);
        },

        file_selected: makeSignal('file_selected'),
        layout_pulled: makeSignal('layout_pulled'),
        macros_sent: makeSignal('macros_sent'),
        patch_pulled: makeSignal('patch_pulled'),
        pdf_exported: makeSignal('pdf_exported'),
        progress_update: makeSignal('progress_update'),
        analyze_complete: makeSignal('analyze_complete'),
        unpack_complete: makeSignal('unpack_complete'),
        artnet_universe_data: makeSignal('artnet_universe_data'),
        artnet_node_update: makeSignal('artnet_node_update'),
        artnet_error: makeSignal('artnet_error')
    };

    // Cleanup: prune this instance's callbacks when its frame unloads
    window.addEventListener('unload', () => {
        registeredChannels.forEach(channel => {
            signalCallbacks[channel] = signalCallbacks[channel].filter(obj => obj.myId !== myId);
        });
    });

    return api;
}

contextBridge.exposeInMainWorld('qt', { webChannelTransport: true });
contextBridge.exposeInMainWorld('QWebChannel', function (transport, callback) {
    const api = buildBridgeAPI();
    setTimeout(() => callback({ objects: { backend: api } }), 50);
});
contextBridge.exposeInMainWorld('appVersion', pkg.version);

contextBridge.exposeInMainWorld('electronUpdater', {
    onUpdateReady: (callback) => ipcRenderer.on('update-ready', (event, info) => callback(info)),
    restartAndInstall: () => ipcRenderer.send('restart-and-install')
});

contextBridge.exposeInMainWorld('electronWindow', {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close')
});

contextBridge.exposeInMainWorld('shellAPI', {
    onSwitchTabRequest: (callback) => ipcRenderer.on('switch-tab-request', (event, toolId) => callback(toolId))
});

// Broadcast clicks inside tool iframes back to the shell to trigger sidebar collapse
if (window !== window.top) {
    document.addEventListener('click', () => {
        window.parent.postMessage({ type: 'iframe-click' }, '*');
    }, { passive: true });
}
