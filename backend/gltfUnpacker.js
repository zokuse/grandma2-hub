const fs = require('fs');
const path = require('path');

function getImageSize(buffer) {
    try {
        if (buffer.length > 24 && buffer.toString('utf8', 1, 4) === 'PNG' && buffer.toString('utf8', 12, 16) === 'IHDR') {
            return {
                w: buffer.readUInt32BE(16),
                h: buffer.readUInt32BE(20)
            };
        } else if (buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
            let i = 2;
            while (i < buffer.length) {
                if (buffer[i] !== 0xFF) break;
                const marker = buffer[i + 1];
                if (marker >= 0xC0 && marker <= 0xC3) {
                    return {
                        h: buffer.readUInt16BE(i + 5),
                        w: buffer.readUInt16BE(i + 7)
                    };
                }
                const length = buffer.readUInt16BE(i + 2);
                i += length + 2;
            }
        }
    } catch (e) {}
    return { w: null, h: null };
}

function resolveImageName(gltf, imgIdx) {
    if (gltf.images && imgIdx < gltf.images.length) {
        const img = gltf.images[imgIdx];
        if (img.name) return img.name;
        if (img.uri && !img.uri.startsWith('data:')) {
            return path.parse(img.uri).name;
        }
    }
    
    let texIdx = null;
    if (gltf.textures) {
        for (let i = 0; i < gltf.textures.length; i++) {
            if (gltf.textures[i].source === imgIdx) {
                if (gltf.textures[i].name) return gltf.textures[i].name;
                texIdx = i;
                break;
            }
        }
    }
    
    if (texIdx !== null && gltf.materials) {
        for (const mat of gltf.materials) {
            const matName = mat.name || 'Material';
            const pbr = mat.pbrMetallicRoughness || {};
            
            if (pbr.baseColorTexture && pbr.baseColorTexture.index === texIdx) return `${matName}_BaseColor`;
            if (pbr.metallicRoughnessTexture && pbr.metallicRoughnessTexture.index === texIdx) return `${matName}_MetallicRoughness`;
            if (mat.normalTexture && mat.normalTexture.index === texIdx) return `${matName}_Normal`;
            if (mat.occlusionTexture && mat.occlusionTexture.index === texIdx) return `${matName}_Occlusion`;
            if (mat.emissiveTexture && mat.emissiveTexture.index === texIdx) return `${matName}_Emissive`;
        }
    }
    return null;
}

function readHeaders(filePath) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const magicBuffer = Buffer.alloc(4);
        fs.readSync(fd, magicBuffer, 0, 4, 0);
        
        if (magicBuffer.toString('utf8') === 'glTF') {
            const headerBuffer = Buffer.alloc(8);
            fs.readSync(fd, headerBuffer, 0, 8, 4);
            
            const chunkHeaderBuffer = Buffer.alloc(8);
            fs.readSync(fd, chunkHeaderBuffer, 0, 8, 12);
            
            const jsonChunkLen = chunkHeaderBuffer.readUInt32LE(0);
            const jsonChunkType = chunkHeaderBuffer.readUInt32LE(4);
            
            if (jsonChunkType !== 0x4E4F534A) { // 'JSON'
                throw new Error("First chunk is not JSON");
            }
            
            const jsonBuffer = Buffer.alloc(jsonChunkLen);
            fs.readSync(fd, jsonBuffer, 0, jsonChunkLen, 20);
            
            const gltf = JSON.parse(jsonBuffer.toString('utf8'));
            const binOffset = 12 + 8 + jsonChunkLen + 8;
            
            return { gltf, binOffset, isGlb: true };
        }
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch(e) {}
        }
    }
    
    // Fallback if not GLB (read full file as text)
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const gltf = JSON.parse(data);
        return { gltf, binOffset: 0, isGlb: false };
    } catch (e) {
        throw new Error("Not a valid GLB or glTF JSON file");
    }
}

async function analyzeGlb(filePath, sendProgress) {
    sendProgress("Parsing GLB/glTF headers...");
    const { gltf, binOffset, isGlb } = readHeaders(filePath);
    
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    const meshCount = gltf.meshes ? gltf.meshes.length : 0;
    const materialCount = gltf.materials ? gltf.materials.length : 0;
    const animationCount = gltf.animations ? gltf.animations.length : 0;
    
    sendProgress("Extracting textures for preview...");
    const textures = [];
    
    if (gltf.images) {
        let fd = null;
        if (isGlb) fd = fs.openSync(filePath, 'r');
        
        for (let i = 0; i < gltf.images.length; i++) {
            const img = gltf.images[i];
            let imgBytes = null;
            let mimeType = 'image/png';
            
            if (isGlb && img.bufferView !== undefined) {
                const bv = gltf.bufferViews[img.bufferView];
                const start = binOffset + (bv.byteOffset || 0);
                const length = bv.byteLength;
                
                imgBytes = Buffer.alloc(length);
                fs.readSync(fd, imgBytes, 0, length, start);
                
                mimeType = img.mimeType || 'image/png';
            } else if (!isGlb) {
                if (img.uri) {
                    if (img.uri.startsWith('data:')) {
                        textures.push({
                            index: i,
                            name: `embedded_${i}`,
                            data_url: img.uri,
                            resolution: ""
                        });
                        continue;
                    } else {
                        const imgPath = path.join(path.dirname(filePath), img.uri);
                        try {
                            imgBytes = fs.readFileSync(imgPath);
                            mimeType = img.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                        } catch(e) {
                            continue;
                        }
                    }
                } else if (img.bufferView !== undefined) {
                    const bv = gltf.bufferViews[img.bufferView];
                    const bufferIdx = bv.buffer || 0;
                    const buffer = gltf.buffers[bufferIdx];
                    if (buffer.uri) {
                        const binPath = path.join(path.dirname(filePath), buffer.uri);
                        try {
                            const start = bv.byteOffset || 0;
                            const length = bv.byteLength;
                            const fdBin = fs.openSync(binPath, 'r');
                            imgBytes = Buffer.alloc(length);
                            fs.readSync(fdBin, imgBytes, 0, length, start);
                            fs.closeSync(fdBin);
                            mimeType = img.mimeType || 'image/png';
                        } catch(e) {
                            continue;
                        }
                    }
                }
            }
            
            if (imgBytes) {
                const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
                let name = `texture_${i}${ext}`;
                const resolvedName = resolveImageName(gltf, i);
                if (resolvedName) {
                    const cleanName = resolvedName.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
                    if (cleanName) name = `${cleanName}${ext}`;
                }
                
                const size = getImageSize(imgBytes);
                const res = (size.w && size.h) ? `${size.w}x${size.h}` : "";
                
                let dataUrl = "";
                if (imgBytes.length <= 3 * 1024 * 1024) { // 3MB limit per texture for preview
                    const b64Data = imgBytes.toString('base64');
                    dataUrl = `data:${mimeType};base64,${b64Data}`;
                } else {
                    // Placeholder 1x1 transparent PNG for oversized textures
                    dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                }
                
                textures.push({
                    index: i,
                    name: name,
                    resolution: res,
                    data_url: dataUrl
                });
            }
        }
        if (fd) fs.closeSync(fd);
    }
    
    sendProgress("Preview ready.");
    return {
        success: true,
        textures: textures,
        texture_count: textures.length,
        stats: {
            size_mb: Math.round(fileSizeMb * 100) / 100,
            meshes: meshCount,
            materials: materialCount,
            animations: animationCount
        }
    };
}

async function unpackGlb(filePath, sendProgress) {
    sendProgress("Analyzing GLB/glTF...");
    const { gltf, binOffset, isGlb } = readHeaders(filePath);
    
    const baseName = path.parse(filePath).name;
    const baseDir = path.dirname(filePath);
    const outDir = path.join(baseDir, `${baseName}_assets`);
    
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    
    let extractedImages = 0;
    
    if (gltf.images) {
        let fdGlb = null;
        if (isGlb) fdGlb = fs.openSync(filePath, 'r');
        
        for (let i = 0; i < gltf.images.length; i++) {
            const img = gltf.images[i];
            if (img.bufferView !== undefined) {
                const bv = gltf.bufferViews[img.bufferView];
                let fPath = filePath;
                let start = binOffset + (bv.byteOffset || 0);
                
                if (!isGlb) {
                    const bufferIdx = bv.buffer || 0;
                    const buffer = gltf.buffers[bufferIdx];
                    if (!buffer.uri) continue;
                    fPath = path.join(baseDir, buffer.uri);
                    start = bv.byteOffset || 0;
                }
                
                const length = bv.byteLength;
                
                try {
                    let imgBytes = Buffer.alloc(length);
                    if (isGlb) {
                        fs.readSync(fdGlb, imgBytes, 0, length, start);
                    } else {
                        const fdBin = fs.openSync(fPath, 'r');
                        fs.readSync(fdBin, imgBytes, 0, length, start);
                        fs.closeSync(fdBin);
                    }
                    
                    let ext = '.png';
                    if (img.mimeType === 'image/jpeg') ext = '.jpg';
                    
                    let imgName = `${baseName}_texture_${i}${ext}`;
                    const resolvedName = resolveImageName(gltf, i);
                    if (resolvedName) {
                        const cleanName = resolvedName.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
                        if (cleanName) imgName = `${cleanName}${ext}`;
                    }
                    
                    const imgOutPath = path.join(outDir, imgName);
                    fs.writeFileSync(imgOutPath, imgBytes);
                    
                    img.uri = imgName;
                    delete img.bufferView;
                    if (img.mimeType) delete img.mimeType;
                    
                    extractedImages++;
                    sendProgress(`Extracted ${imgName}...`);
                } catch (e) {
                    sendProgress(`Failed to extract texture ${i}: ${e.message}`);
                }
            } else if (!isGlb && img.uri) {
                if (!img.uri.startsWith('data:')) {
                    const srcImgPath = path.join(baseDir, img.uri);
                    const dstImgPath = path.join(outDir, path.basename(img.uri));
                    try {
                        fs.copyFileSync(srcImgPath, dstImgPath);
                        img.uri = path.basename(img.uri);
                        extractedImages++;
                        sendProgress(`Copied ${path.basename(img.uri)}...`);
                    } catch (e) {
                        sendProgress(`Failed to copy texture ${img.uri}: ${e.message}`);
                    }
                }
            }
        }
        if (fdGlb) fs.closeSync(fdGlb);
    }
    
    if (isGlb) {
        const binName = `${baseName}.bin`;
        const binPath = path.join(outDir, binName);
        sendProgress("Writing BIN chunk...");
        
        const fdIn = fs.openSync(filePath, 'r');
        const fdOut = fs.openSync(binPath, 'w');
        
        const chunkHeaderBuffer = Buffer.alloc(8);
        fs.readSync(fdIn, chunkHeaderBuffer, 0, 8, binOffset - 8);
        const binChunkLen = chunkHeaderBuffer.readUInt32LE(0);
        
        let bytesLeft = binChunkLen;
        const chunkSize = 1024 * 1024 * 8; // 8MB
        const buffer = Buffer.alloc(chunkSize);
        let readPos = binOffset;
        
        while (bytesLeft > 0) {
            const readSize = Math.min(bytesLeft, chunkSize);
            fs.readSync(fdIn, buffer, 0, readSize, readPos);
            fs.writeSync(fdOut, buffer, 0, readSize);
            readPos += readSize;
            bytesLeft -= readSize;
        }
        fs.closeSync(fdIn);
        fs.closeSync(fdOut);
        
        if (gltf.buffers && gltf.buffers.length > 0) {
            gltf.buffers[0].uri = binName;
        }
    } else {
        if (gltf.buffers) {
            for (const buf of gltf.buffers) {
                if (buf.uri && !buf.uri.startsWith('data:')) {
                    const srcBin = path.join(baseDir, buf.uri);
                    const dstBin = path.join(outDir, buf.uri);
                    try {
                        fs.copyFileSync(srcBin, dstBin);
                        sendProgress(`Copied ${buf.uri}...`);
                    } catch (e) {}
                }
            }
        }
    }
    
    const gltfName = `${baseName}.gltf`;
    const gltfPath = path.join(outDir, gltfName);
    fs.writeFileSync(gltfPath, JSON.stringify(gltf, null, 2), 'utf8');
    
    sendProgress("Unpack Complete!");
    return {
        success: true,
        message: `Successfully unpacked to ${outDir}, extracting ${extractedImages} textures.`
    };
}

function saveSingleTexture(filePath, texIndex, dataUrl, texName) {
    const baseDir = path.dirname(filePath);
    const savePath = path.join(baseDir, texName);

    try {
        const { gltf, binOffset, isGlb } = readHeaders(filePath);
        if (gltf && gltf.images && gltf.images[texIndex]) {
            const img = gltf.images[texIndex];
            let imgBytes = null;
            
            if (img.uri !== undefined) {
                if (img.uri.startsWith('data:')) {
                    const b64Data = img.uri.split(',')[1];
                    imgBytes = Buffer.from(b64Data, 'base64');
                } else {
                    const imgPath = path.join(baseDir, img.uri);
                    imgBytes = fs.readFileSync(imgPath);
                }
            } else if (img.bufferView !== undefined) {
                const bv = gltf.bufferViews[img.bufferView];
                let fPath = filePath;
                let start = binOffset + (bv.byteOffset || 0);
                
                if (!isGlb) {
                    const bufferIdx = bv.buffer || 0;
                    const buffer = gltf.buffers[bufferIdx];
                    if (buffer.uri) {
                        fPath = path.join(baseDir, buffer.uri);
                        start = bv.byteOffset || 0;
                    }
                }
                
                const fdBin = fs.openSync(fPath, 'r');
                imgBytes = Buffer.alloc(bv.byteLength);
                fs.readSync(fdBin, imgBytes, 0, bv.byteLength, start);
                fs.closeSync(fdBin);
            }
            
            if (imgBytes) {
                fs.writeFileSync(savePath, imgBytes);
                return `Saved ${texName} successfully!`;
            }
        }
    } catch (e) {
        // Fallback to dataUrl from frontend if extraction fails
    }

    if (!dataUrl || !dataUrl.startsWith('data:')) {
        throw new Error("Not a valid base64 image data URL.");
    }
    const b64Data = dataUrl.split(',')[1];
    const imgBytes = Buffer.from(b64Data, 'base64');
    fs.writeFileSync(savePath, imgBytes);
    return `Saved ${texName} successfully!`;
}

module.exports = {
    analyzeGlb,
    unpackGlb,
    saveSingleTexture
};
