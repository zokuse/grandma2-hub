const { ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const MA2Client = require('./MA2Client');
const gltfUnpacker = require('./gltfUnpacker');

function cleanShowName(name) {
    if (!name) return "";
    return name.replace(/[\s\+\-_]*(capture|grandma2)[\s\+\-_]*/ig, ' ').replace(/\s+/g, ' ').trim();
}

// Helper to open file dialog and read XML
async function importXmlFile(title, defaultPath) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: title,
        defaultPath: defaultPath,
        properties: ['openFile'],
        filters: [{ name: 'XML Files', extensions: ['xml'] }, { name: 'All Files', extensions: ['*'] }]
    });

    if (!canceled && filePaths.length > 0) {
        try {
            const data = fs.readFileSync(filePaths[0], 'utf8');
            let showName = "";
            const showMatch = data.match(/showfile="([^"]+)"/i);
            if (showMatch && showMatch[1]) showName = showMatch[1];
            if (!showName) showName = path.basename(filePaths[0], '.xml');
            
            showName = cleanShowName(showName);
            
            return JSON.stringify({ success: true, data: data, showName: showName });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }
    return JSON.stringify({ success: false, error: "Cancelled" });
}

let ma2Client;
function registerIpcHandlers() {
    ma2Client = new MA2Client();
    ipcMain.handle('clear_credentials', async () => {
        ma2Client.clearCredentials();
        return JSON.stringify({ success: true });
    });

    ipcMain.handle('get_local_ips', async () => {
        return await ma2Client.getLocalIps();
    });

    ipcMain.handle('get_saved_credentials', async () => {
        return JSON.stringify(ma2Client.credentials || null);
    });

    ipcMain.handle('save_global_credentials', async (e, credsJson) => {
        try {
            const creds = JSON.parse(credsJson);
            ma2Client.saveCredentials(creds);
            return JSON.stringify({ success: true });
        } catch (err) {
            return JSON.stringify({ success: false, error: err.message });
        }
    });

    ipcMain.handle('get_fixture_specs', async () => {
        try {
            if (!fs.existsSync(ma2Client.fixtureSpecsFile)) {
                // Auto-create from the default template if it doesn't exist
                const defaultPath = path.join(__dirname, '..', 'assets', 'patch', 'default_fixture_specs.json');
                let defaultData = "[\n  \n]";
                if (fs.existsSync(defaultPath)) {
                    defaultData = fs.readFileSync(defaultPath, 'utf8');
                }
                fs.writeFileSync(ma2Client.fixtureSpecsFile, defaultData, 'utf8');
            }
            return fs.readFileSync(ma2Client.fixtureSpecsFile, 'utf8');
        } catch (e) {
            console.error("Error reading/creating fixture specs:", e);
        }
        return "[]";
    });

    ipcMain.handle('save_fixture_specs', async (e, jsonStr) => {
        try {
            fs.writeFileSync(ma2Client.fixtureSpecsFile, jsonStr, 'utf8');
            return JSON.stringify({ success: true });
        } catch (err) {
            return JSON.stringify({ success: false, error: err.message });
        }
    });

    ipcMain.handle('import_layout', async () => {
        const initDir = fs.existsSync(ma2Client.layoutDir) ? ma2Client.layoutDir : "";
        return await importXmlFile("Select MA2 Layout XML", initDir);
    });

    ipcMain.handle('import_patch', async () => {
        const initDir = fs.existsSync(ma2Client.patchDir) ? ma2Client.patchDir : "";
        return await importXmlFile("Select MA2 Patch XML", initDir);
    });

    ipcMain.handle('import_capture_xml', async () => {
        return await importXmlFile("Select Capture XML Export", "");
    });

    ipcMain.handle('parse_ma2_patch', async (e, xmlStr) => {
        try {
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_"
            });
            const cleanXml = xmlStr.replace('xmlns="http://schemas.malighting.de/grandma2/xml/MA"', "");
            const result = parser.parse(cleanXml);
            
            const fixtures = [];
            const root = result.MA || result.Feature || result;
            
            // Fast-xml-parser returns objects. We need to traverse to find Layers -> Fixtures.
            // This mimics the ET.findall('.//Layer')
            const layers = [];
            function findLayers(obj) {
                if (!obj) return;
                if (Array.isArray(obj)) {
                    obj.forEach(findLayers);
                } else if (typeof obj === 'object') {
                    if (obj.Layer) {
                        layers.push(...(Array.isArray(obj.Layer) ? obj.Layer : [obj.Layer]));
                    }
                    Object.values(obj).forEach(findLayers);
                }
            }
            findLayers(root);

            layers.forEach(layer => {
                const layerName = layer["@_name"] || "";
                let layerFixtures = layer.Fixture || [];
                if (!Array.isArray(layerFixtures)) layerFixtures = [layerFixtures];
                
                layerFixtures.forEach(fixture => {
                    const fixtureId = parseInt(fixture["@_fixture_id"] || 0);
                    const fixtureName = fixture["@_name"] || "";
                    let fixtureType = fixture.FixtureType ? (fixture.FixtureType["@_name"] || "") : "";
                    if (/^\d+\s+(.*)/.test(fixtureType)) fixtureType = fixtureType.match(/^\d+\s+(.*)/)[1];
                    
                    if (!fixture.SubFixture) return;
                    let subfixtures = Array.isArray(fixture.SubFixture) ? fixture.SubFixture : [fixture.SubFixture];
                    
                    // We just take the first subfixture for position, matching python behavior
                    const sf = subfixtures[0];
                    if (!sf) return;
                    
                    let dmxAddress = 0;
                    if (sf.Patch && sf.Patch.Address) {
                        dmxAddress = parseInt(sf.Patch.Address) || 0;
                    }
                    
                    let posX=0, posY=0, posZ=0, rotX=0, rotY=0, rotZ=0;
                    if (sf.AbsolutePosition) {
                        if (sf.AbsolutePosition.Location) {
                            posX = parseFloat(sf.AbsolutePosition.Location["@_x"] || 0);
                            posY = parseFloat(sf.AbsolutePosition.Location["@_y"] || 0);
                            posZ = parseFloat(sf.AbsolutePosition.Location["@_z"] || 0);
                        }
                        if (sf.AbsolutePosition.Rotation) {
                            rotX = parseFloat(sf.AbsolutePosition.Rotation["@_x"] || 0);
                            rotY = parseFloat(sf.AbsolutePosition.Rotation["@_y"] || 0);
                            rotZ = parseFloat(sf.AbsolutePosition.Rotation["@_z"] || 0);
                        }
                    }

                    fixtures.push({
                        fixture_id: fixtureId,
                        dmx_address: dmxAddress,
                        name: fixtureName,
                        layer: layerName,
                        fixture_type: fixtureType,
                        pos_x: posX, pos_y: posY, pos_z: posZ,
                        rot_x: rotX, rot_y: rotY, rot_z: rotZ,
                        has_position: !(posX === 0 && posY === 0 && posZ === 0)
                    });
                });
            });

            return JSON.stringify({ success: true, data: fixtures });
        } catch (err) {
            return JSON.stringify({ success: false, error: "Parse error: " + err.message });
        }
    });

    ipcMain.handle('parse_capture_xml', async (e, xmlStr) => {
        try {
            const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
            const result = parser.parse(xmlStr);
            const fixtures = [];
            const layers = [];
            
            function findLayers(obj) {
                if (!obj) return;
                if (Array.isArray(obj)) obj.forEach(findLayers);
                else if (typeof obj === 'object') {
                    if (obj.Layer) layers.push(...(Array.isArray(obj.Layer) ? obj.Layer : [obj.Layer]));
                    Object.values(obj).forEach(findLayers);
                }
            }
            findLayers(result);

            layers.forEach(layer => {
                const layerName = layer["@_name"] || "";
                let layerFixtures = layer.Fixture || [];
                if (!Array.isArray(layerFixtures)) layerFixtures = [layerFixtures];
                
                layerFixtures.forEach(fixture => {
                    const rawFixtureId = parseInt(fixture["@_fixture_id"] || 0);
                    const channelId = parseInt(fixture["@_channel_id"] || 0);
                    const fixtureName = fixture["@_name"] || "";
                    
                    let canonicalId = 0, idSource = "unknown";
                    if (rawFixtureId !== 0) { canonicalId = rawFixtureId; idSource = "fixture_id"; }
                    else if (channelId !== 0) { canonicalId = channelId; idSource = "channel_id"; }
                    
                    let fixtureType = fixture.FixtureType ? (fixture.FixtureType["@_name"] || "") : "";
                    if (/^\d+\s+(.*)/.test(fixtureType)) fixtureType = fixtureType.match(/^\d+\s+(.*)/)[1];
                    
                    if (!fixture.SubFixture) return;
                    let subfixtures = Array.isArray(fixture.SubFixture) ? fixture.SubFixture : [fixture.SubFixture];
                    const sf = subfixtures[0];
                    if (!sf) return;
                    
                    let dmxAddress = 0;
                    if (sf.Patch && sf.Patch.Address) dmxAddress = parseInt(sf.Patch.Address) || 0;
                    
                    let posX=0, posY=0, posZ=0, rotX=0, rotY=0, rotZ=0;
                    if (sf.AbsolutePosition) {
                        if (sf.AbsolutePosition.Location) {
                            posX = parseFloat(sf.AbsolutePosition.Location["@_x"] || 0);
                            posY = parseFloat(sf.AbsolutePosition.Location["@_y"] || 0);
                            posZ = parseFloat(sf.AbsolutePosition.Location["@_z"] || 0);
                        }
                        if (sf.AbsolutePosition.Rotation) {
                            rotX = parseFloat(sf.AbsolutePosition.Rotation["@_x"] || 0);
                            rotY = parseFloat(sf.AbsolutePosition.Rotation["@_y"] || 0);
                            rotZ = parseFloat(sf.AbsolutePosition.Rotation["@_z"] || 0);
                        }
                    }

                    fixtures.push({
                        fixture_id: canonicalId,
                        id_source: idSource,
                        dmx_address: dmxAddress,
                        name: fixtureName,
                        layer: layerName,
                        fixture_type: fixtureType,
                        pos_x: posX, pos_y: posY, pos_z: posZ,
                        rot_x: rotX, rot_y: rotY, rot_z: rotZ
                    });
                });
            });

            return JSON.stringify({ success: true, data: fixtures });
        } catch (err) {
            return JSON.stringify({ success: false, error: "Parse error: " + err.message });
        }
    });

    ipcMain.handle('pull_layout', async (e, loginStr, layoutId) => {
        try {
            const creds = JSON.parse(loginStr);
            ma2Client.saveCredentials(creds);
            
            const socket = await ma2Client.telnetSession(creds, msg => e.senderFrame.send('progress_update', msg));
            
            e.senderFrame.send('progress_update', `Exporting Layout ${layoutId}...`);
            const exportRes = await socket.sendCommand(`Export Layout ${layoutId} "cloner_temp_layout" /noconfirm`, 10000);
            const lowerExport = exportRes.toLowerCase();
            
            if (lowerExport.includes('error')) {
                e.senderFrame.send('layout_pulled', JSON.stringify({ success: false, error: "GrandMA2 rejected the layout export. Please check if the Layout ID exists and menus are closed." }));
                return;
            }
            
            socket.destroy();

            const tempFile = path.join(ma2Client.layoutDir, "cloner_temp_layout.xml");
            e.senderFrame.send('progress_update', "Reading XML file...");
            
            if (!await ma2Client.waitForFile(tempFile, 10000)) {
                e.senderFrame.send('layout_pulled', JSON.stringify({ success: false, error: `Failed to pull Layout ${layoutId}. Took too long to save.` }));
                return;
            }

            const data = fs.readFileSync(tempFile, 'utf8');
            try { fs.unlinkSync(tempFile); } catch (err) {}
            
            let showName = "";
            const showMatch = data.match(/showfile="([^"]+)"/i);
            if (showMatch && showMatch[1]) showName = showMatch[1];
            showName = cleanShowName(showName);
            
            e.senderFrame.send('layout_pulled', JSON.stringify({ success: true, data: data, showName: showName }));
        } catch (err) {
            e.senderFrame.send('layout_pulled', JSON.stringify({ success: false, error: err.message }));
        }
    });

    ipcMain.handle('pull_patch', async (e, loginStr) => {
        try {
            const creds = JSON.parse(loginStr);
            ma2Client.saveCredentials(creds);
            
            const socket = await ma2Client.telnetSession(creds, msg => e.senderFrame.send('progress_update', msg));
            
            e.senderFrame.send('progress_update', "Navigating to Patch Layers...");
            await socket.sendCommand('CD Root');
            await socket.sendCommand('CD EditSetup');
            const layerRes = await socket.sendCommand('CD Layers');
            if (layerRes.toLowerCase().includes('error #14')) {
                socket.destroy();
                e.senderFrame.send('patch_pulled', JSON.stringify({ success: false, error: "No fixtures are patched in this showfile. (Error: Layers object does not exist)" }));
                return;
            }
            e.senderFrame.send('progress_update', "Exporting Patch (This may take ~10 seconds)...");
            const exportRes = await socket.sendCommand('Export 1 Thru 256 "temp_patch" /noconfirm', 15000);
            const lowerExport = exportRes.toLowerCase();
            
            await socket.sendCommand('CD Root');
            socket.destroy();
            
            if (lowerExport.includes('error') && !lowerExport.includes('no cue source given') && !lowerExport.includes('error #28')) {
                e.senderFrame.send('patch_pulled', JSON.stringify({ success: false, error: "GrandMA2 rejected the patch export. Please close the 'Patch & Fixture Schedule' window on your console and try again." }));
                return;
            }

            const tempFile = path.join(ma2Client.patchDir, "temp_patch.xml");
            if (!await ma2Client.waitForFile(tempFile, 15000)) {
                e.senderFrame.send('patch_pulled', JSON.stringify({ success: false, error: "Failed to pull Patch. File never appeared in 'fixture_layers'." }));
                return;
            }

            const data = fs.readFileSync(tempFile, 'utf8');
            try { fs.unlinkSync(tempFile); } catch (err) {}
            
            let showName = "";
            const showMatch = data.match(/showfile="([^"]+)"/i);
            if (showMatch && showMatch[1]) showName = showMatch[1];
            showName = cleanShowName(showName);
            
            e.senderFrame.send('patch_pulled', JSON.stringify({ success: true, data: data, showName: showName }));
        } catch (err) {
            e.senderFrame.send('patch_pulled', JSON.stringify({ success: false, error: err.message }));
        }
    });

    // File paths — stored in AppData\Roaming\grandma2-hub\
    const userData = app.getPath('userData');
    const dmxDictPath = path.join(userData, '.ma2_hub_dmx_dict.json');

    // One-time migration: move old homedir DMX dict to AppData if needed
    const oldDmxDictPath = path.join(os.homedir(), '.ma2_hub_dmx_dict.json');
    if (fs.existsSync(oldDmxDictPath) && !fs.existsSync(dmxDictPath)) {
        try {
            fs.copyFileSync(oldDmxDictPath, dmxDictPath);
            fs.unlinkSync(oldDmxDictPath);
            console.log('[ipcHandlers] Migrated DMX dict to AppData.');
        } catch (e) {
            console.error('[ipcHandlers] Migration failed for DMX dict:', e.message);
        }
    }

    // ---- DMX Dictionary ----
    ipcMain.handle('get_dmx_dict', () => {
        try {
            if (fs.existsSync(dmxDictPath)) {
                return fs.readFileSync(dmxDictPath, 'utf8');
            }
            return "{}";
        } catch (err) {
            return "{}";
        }
    });

    ipcMain.handle('save_dmx_dict', (event, dictStr) => {
        try {
            fs.writeFileSync(dmxDictPath, dictStr, 'utf8');
            return JSON.stringify({ success: true });
        } catch (err) {
            return JSON.stringify({ success: false, error: err.message });
        }
    });

    ipcMain.handle('export_macros', async (e, xmlData, filename) => {
        try {
            if (!fs.existsSync(ma2Client.macroDir)) {
                fs.mkdirSync(ma2Client.macroDir, { recursive: true });
            }
            const filePath = path.join(ma2Client.macroDir, `${filename}.xml`);
            fs.writeFileSync(filePath, xmlData, 'utf8');
            return JSON.stringify({ success: true, path: filePath });
        } catch (err) {
            return JSON.stringify({ success: false, error: err.message });
        }
    });

    ipcMain.handle('send_to_console', async (e, macrosJson, loginStr, baseIdStr) => {
        try {
            const creds = JSON.parse(loginStr);
            ma2Client.saveCredentials(creds);
            const macros = JSON.parse(macrosJson);
            let currentBaseId = baseIdStr ? parseInt(baseIdStr) : null;
            
            const socket = await ma2Client.telnetSession(creds, msg => e.senderFrame.send('progress_update', msg));
            e.senderFrame.send('progress_update', "Flushing Programmer...");
            await socket.sendCommand('ClearAll');
            await socket.sendCommand('BlindEdit On');

            for (let i = 0; i < macros.length; i++) {
                const m = macros[i];
                const mId = currentBaseId !== null ? currentBaseId : m.index;
                const name = (m.name || "").replace(/"/g, "'").replace(/\r/g, "").replace(/\n/g, "");
                e.senderFrame.send('progress_update', `Storing Macro ${mId} (${name}) - ${i+1}/${macros.length}`);
                
                await socket.sendCommand(`Delete Macro ${mId} /noconfirm`);
                await socket.sendCommand(`Store Macro ${mId}`);
                for (let j = 0; j < m.lines.length; j++) {
                    const line = m.lines[j];
                    const safeLine = (typeof line === 'string' ? line : (line.command || "")).replace(/"/g, "'").replace(/\r/g, "").replace(/\n/g, "");
                    await socket.sendCommand(`Store Macro 1.${mId}.${j+1} "${safeLine}"`);
                }
                await socket.sendCommand(`Label Macro ${mId} "${name}"`);
                
                if (currentBaseId !== null) {
                    currentBaseId++;
                }
            }
            
            await socket.sendCommand('BlindEdit Off', 15000);
            await new Promise(r => setTimeout(r, 1000));
            socket.destroy();
            e.senderFrame.send('macros_sent', JSON.stringify({ success: true, message: `Successfully sent ${macros.length} macros to MA2!` }));
        } catch (err) {
            e.senderFrame.send('macros_sent', JSON.stringify({ success: false, error: err.message }));
        }
    });
    
    ipcMain.handle('send_xyz_macro', async (e, loginStr, mappingsJson) => {
        try {
            const creds = JSON.parse(loginStr);
            ma2Client.saveCredentials(creds);
            const mappings = JSON.parse(mappingsJson);
            
            const socket = await ma2Client.telnetSession(creds, msg => e.senderFrame.send('progress_update', msg));
            e.senderFrame.send('progress_update', "Flushing Programmer...");
            await socket.sendCommand('ClearAll');
            await socket.sendCommand('BlindEdit On');

            let count = 0;
            const keys = Object.keys(mappings);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const m = mappings[key];
                if (!m.ma2_fixture_id) continue;
                
                e.senderFrame.send('progress_update', `Assigning Position Fix ${m.ma2_fixture_id} - ${i+1}/${keys.length}`);
                
                const x = Math.round((m.pos_x||0) * 1000) / 1000;
                const y = Math.round((m.pos_y||0) * 1000) / 1000;
                const z = Math.round((m.pos_z||0) * 1000) / 1000;
                const rx = Math.round((m.rot_x||0) * 1000) / 1000;
                const ry = Math.round((m.rot_y||0) * 1000) / 1000;
                const rz = Math.round((m.rot_z||0) * 1000) / 1000;
                
                const cmd = `Clear; Fixture ${m.ma2_fixture_id}; Move3D ${x} ${y} ${z}; Rotate3D ${rx} ${ry} ${rz}`;
                await socket.sendCommand(cmd);
                
                count++;
                await new Promise(r => setTimeout(r, 30));
            }
            
            await socket.sendCommand('BlindEdit Off', 15000);
            await new Promise(r => setTimeout(r, 1000));
            socket.destroy();
            e.senderFrame.send('macros_sent', JSON.stringify({ success: true, message: `Successfully pushed XYZ positions for ${count} fixtures to MA2!` }));
        } catch (err) {
            e.senderFrame.send('macros_sent', JSON.stringify({ success: false, error: err.message }));
        }
    });

    ipcMain.handle('send_timecode_to_ma2', async (e, loginStr, xmlData, settingsStr) => {
        try {
            const creds = JSON.parse(loginStr);
            ma2Client.saveCredentials(creds);
            const settings = JSON.parse(settingsStr);
            
            if (!fs.existsSync(ma2Client.layoutDir)) {
                fs.mkdirSync(ma2Client.layoutDir, { recursive: true });
            }
            const filename = "tc_creator_temp.xml";
            const filePath = path.join(ma2Client.layoutDir, filename);
            fs.writeFileSync(filePath, xmlData, 'utf8');

            const socket = await ma2Client.telnetSession(creds, msg => e.senderFrame.send('progress_update', msg));
            
            const doMain = settings.exportMode.includes('main') || settings.exportMode.includes('sub');
            const doTc = !settings.exportMode.includes('only') || settings.exportMode === 'tc-only' || settings.exportMode.includes('tc');

            if (doMain) {
                // Sequence is now built entirely through followUpCommands via 'Store Sequence' commands
            }
            let followUpErrors = 0;
            if (settings.followUpCommands && settings.followUpCommands.length > 0) {
                e.senderFrame.send('progress_update', `Applying Cues and Sequence settings...`);
                for (let cmd of settings.followUpCommands) {
                    try {
                        cmd = (cmd || "").replace(/\r/g, "").replace(/\n/g, "");
                        const response = await socket.sendCommand(cmd, 3000);
                    } catch (cmdErr) {
                        console.error(`Failed to execute follow-up command: ${cmd}`, cmdErr);
                        followUpErrors++;
                    }
                }
            }

            if (doTc) {
                e.senderFrame.send('progress_update', `Importing Timecode...`);
                await socket.sendCommand(`Import "${filename}" At Timecode ${settings.startTimecodeIndex} /noconfirm`, 10000);
                
                if (settings.executor) {
                    e.senderFrame.send('progress_update', `Linking Timecode to Executor...`);
                    await socket.sendCommand(`Assign Executor ${settings.executor.page}.${settings.executor.number} At Timecode ${settings.startTimecodeIndex} Track 1`, 3000);
                }
            }

            await new Promise(r => setTimeout(r, 1000));
            socket.destroy();
            
            try { fs.unlinkSync(filePath); } catch(err) {}

            if (followUpErrors > 0) {
                e.senderFrame.send('macros_sent', JSON.stringify({ success: true, message: `Timecode imported, but ${followUpErrors} styling commands failed. Check executor/cue states.` }));
            } else {
                e.senderFrame.send('macros_sent', JSON.stringify({ success: true, message: `Successfully imported Timecode data to MA2!` }));
            }
        } catch (err) {
            e.senderFrame.send('macros_sent', JSON.stringify({ success: false, error: err.message }));
        }
    });

    ipcMain.handle('export_pdf', async (e, htmlContent, filename, layoutMode = 'portrait') => {
        const { BrowserWindow } = require('electron');
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: "Export to PDF",
            defaultPath: `${filename}.pdf`,
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });

        if (canceled || !filePath) return JSON.stringify({ success: false, error: "Cancelled" });
        
        let targetPath = filePath.endsWith('.pdf') ? filePath : filePath + '.pdf';
        
        // Set viewport to match the target page size at 96dpi so layout renders correctly
        const winWidth  = (layoutMode === 'a5-2up') ? 794 : 1123;  // A5-L: 210mm | A4: 297mm @ 96dpi
        const winHeight = (layoutMode === 'a5-2up') ? 559 : 794;   // A5-L: 148mm | A4: 210mm @ 96dpi
        const win = new BrowserWindow({ show: false, width: winWidth, height: winHeight, webPreferences: { offscreen: true } });
        
        return new Promise((resolve) => {
            let timeout = setTimeout(() => {
                win.destroy();
                resolve(JSON.stringify({ success: false, error: "PDF generation timed out." }));
            }, 30000);

            win.webContents.on('did-finish-load', async () => {
                try {
                    const pdfData = await win.webContents.printToPDF({
                        landscape: layoutMode === 'landscape' || layoutMode === 'a5-2up',
                        printBackground: true,
                        displayHeaderFooter: true,
                        headerTemplate: '<div></div>',
                        footerTemplate: '<div style="font-size: 9px; font-family: Arial, sans-serif; width: 100%; text-align: right; padding-right: 15mm; color: #555;">Page <span class="pageNumber"></span></div>',
                        margins: { marginType: 'none' },  // let @page CSS control all margins
                        pageSize: layoutMode === 'a5-2up' ? 'A5' : 'A4'
                    });
                    
                    let finalPdfData = pdfData;
                    
                    if (layoutMode === 'a5-2up') {
                        try {
                            const { PDFDocument } = require('pdf-lib');
                            const srcDoc = await PDFDocument.load(pdfData);
                            const outDoc = await PDFDocument.create();
                            // pdfData is a Buffer (Uint8Array), embedPdf can accept it directly
                            const embeddedPages = await outDoc.embedPdf(pdfData, srcDoc.getPageIndices());
                            
                            // A4 size in points: 595.28 x 841.89
                            // A5 landscape size in points: 595.28 x 420.945
                            for (let i = 0; i < embeddedPages.length; i += 2) {
                                const outPage = outDoc.addPage([595.28, 841.89]);
                                // Top half — scale to exactly fill the top half of A4
                                outPage.drawPage(embeddedPages[i], { x: 0, y: 420.945, width: 595.28, height: 420.945 });
                                // Bottom half
                                if (i + 1 < embeddedPages.length) {
                                    outPage.drawPage(embeddedPages[i + 1], { x: 0, y: 0, width: 595.28, height: 420.945 });
                                }
                            }
                            const outBytes = await outDoc.save();
                            finalPdfData = Buffer.from(outBytes);
                        } catch (err) {
                            console.error("Error creating 2-up PDF:", err);
                            // Fallback to original A5 pdfData if merging fails
                        }
                    }

                    fs.writeFileSync(targetPath, finalPdfData);
                    clearTimeout(timeout);
                    win.destroy();
                    resolve(JSON.stringify({ success: true, path: targetPath }));
                } catch (err) {
                    clearTimeout(timeout);
                    win.destroy();
                    resolve(JSON.stringify({ success: false, error: err.message }));
                }
            });
            win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        });
    });
    ipcMain.handle('select_file', async (e) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: "Select glTF/GLB File",
            properties: ['openFile'],
            filters: [{ name: '3D Models', extensions: ['glb', 'gltf'] }, { name: 'All Files', extensions: ['*'] }]
        });
        if (!canceled && filePaths.length > 0) {
            e.senderFrame.send('file_selected', JSON.stringify({ success: true, path: filePaths[0], filename: path.basename(filePaths[0]) }));
        }
    });

    ipcMain.handle('analyze_glb', async (e, filePath) => {
        try {
            const res = await gltfUnpacker.analyzeGlb(filePath, (msg) => {
                e.senderFrame.send('progress_update', msg);
            });
            e.senderFrame.send('analyze_complete', JSON.stringify(res));
        } catch (err) {
            e.senderFrame.send('analyze_complete', JSON.stringify({ success: false, error: err.message }));
        }
    });

    ipcMain.handle('unpack_glb', async (e, filePath) => {
        try {
            const res = await gltfUnpacker.unpackGlb(filePath, (msg) => {
                e.senderFrame.send('progress_update', msg);
            });
            e.senderFrame.send('unpack_complete', JSON.stringify(res));
        } catch (err) {
            e.senderFrame.send('unpack_complete', JSON.stringify({ success: false, error: err.message }));
        }
    });

    ipcMain.handle('save_single_texture', async (e, filePath, texIndex, dataUrl, texName) => {
        try {
            const msg = gltfUnpacker.saveSingleTexture(filePath, texIndex, dataUrl, texName);
            e.senderFrame.send('progress_update', msg);
        } catch (err) {
            e.senderFrame.send('progress_update', `Failed to save texture: ${err.message}`);
        }
    });
}

module.exports = { registerIpcHandlers };
