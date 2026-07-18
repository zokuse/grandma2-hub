const { ipcRenderer } = require('electron');
window.appVersion = require('./package.json').version;

let activeRequester = null;
let instanceCounter = 0;

// Global signal registry to prevent memory leaks and MaxListenersExceededWarning on reload
const signalCallbacks = {
    file_selected: [],
    layout_pulled: [],
    macros_sent: [],
    patch_pulled: [],
    pdf_exported: [],
    progress_update: [],
    analyze_complete: [],
    unpack_complete: []
};

// Register ONE listener per channel
Object.keys(signalCallbacks).forEach(channel => {
    ipcRenderer.on(channel, (e, ...args) => {
        signalCallbacks[channel].forEach(obj => {
            if (activeRequester === obj.myId) {
                try {
                    obj.cb(...args);
                } catch (err) {
                    obj.dead = true;
                }
            }
        });
        // Cleanup dead callbacks
        signalCallbacks[channel] = signalCallbacks[channel].filter(obj => !obj.dead);
    });
});

window.qt = { webChannelTransport: true };
window.QWebChannel = function(transport, callback) {
    const myId = ++instanceCounter;

    function makeInvoke(channel) {
        return (...args) => {
            activeRequester = myId; // Tandai iframe ini sebagai peminta aktif
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

    // Setiap iframe mendapatkan instance objek backend-nya sendiri
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
        switch_to: (toolId) => {
            if (window.parent && typeof window.parent.switchTab === 'function') {
                window.parent.switchTab(toolId);
            } else {
                console.error("switchTab not found on parent window");
            }
        },

        // Signals: Dispatch via global registry
        file_selected: { connect: (cb) => signalCallbacks.file_selected.push({ myId, cb }), disconnect: (cb) => signalCallbacks.file_selected = signalCallbacks.file_selected.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        layout_pulled: { connect: (cb) => signalCallbacks.layout_pulled.push({ myId, cb }), disconnect: (cb) => signalCallbacks.layout_pulled = signalCallbacks.layout_pulled.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        macros_sent: { connect: (cb) => signalCallbacks.macros_sent.push({ myId, cb }), disconnect: (cb) => signalCallbacks.macros_sent = signalCallbacks.macros_sent.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        patch_pulled: { connect: (cb) => signalCallbacks.patch_pulled.push({ myId, cb }), disconnect: (cb) => signalCallbacks.patch_pulled = signalCallbacks.patch_pulled.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        pdf_exported: { connect: (cb) => signalCallbacks.pdf_exported.push({ myId, cb }), disconnect: (cb) => signalCallbacks.pdf_exported = signalCallbacks.pdf_exported.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        progress_update: { connect: (cb) => signalCallbacks.progress_update.push({ myId, cb }), disconnect: (cb) => signalCallbacks.progress_update = signalCallbacks.progress_update.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        analyze_complete: { connect: (cb) => signalCallbacks.analyze_complete.push({ myId, cb }), disconnect: (cb) => signalCallbacks.analyze_complete = signalCallbacks.analyze_complete.filter(obj => obj.myId !== myId || obj.cb !== cb) },
        unpack_complete: { connect: (cb) => signalCallbacks.unpack_complete.push({ myId, cb }), disconnect: (cb) => signalCallbacks.unpack_complete = signalCallbacks.unpack_complete.filter(obj => obj.myId !== myId || obj.cb !== cb) }
    };

    setTimeout(() => {
        callback({
            objects: {
                backend: api
            }
        });
    }, 50);
};

// ─── Update Bridge ─────────────────────────────────────────────────────────
// Exposes a clean API for the shell app to respond to auto-update events.
window.electronUpdater = {
    onUpdateReady: (callback) => {
        ipcRenderer.on('update-ready', (event, info) => {
            callback(info);
        });
    },
    restartAndInstall: () => {
        ipcRenderer.send('restart-and-install');
    }
};
// ──────────────────────────────────────────────────────────────────────────
