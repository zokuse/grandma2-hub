const fs = require('fs');
function parseReaperProject(fileContent) {
  const result = {
    offset: 0,
    mainMarkers: [],
    tracks: [],
    audioFile: null
  };

  result.audioFiles = [];
  
  const lines = fileContent.split('\n');
  let currentTrack = null;
  let inItem = false;
  let currentItemPos = 0;
  let currentItem = null;
  let inSourceBlock = false;
  let blockDepth = 0;
  let trackDepth = -1;
  let isTrackMuted = false;
  let isItemMuted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('<')) {
        blockDepth++;
    } else if (trimmedLine === '>') {
        blockDepth--;
    }

    if (trimmedLine.startsWith('<SOURCE ')) {
        inSourceBlock = true;
    } else if (inSourceBlock && trimmedLine === '>') {
        inSourceBlock = false;
    }

    if (trimmedLine === '<ITEM') {
        inItem = true;
    } else if (inItem && trimmedLine === '>') {
        // Wait, REAPER <ITEM ends with > but we already check > for SOURCE.
        // Actually, REAPER items have nested <SOURCE> ... > so a > closes the inner block.
        // If we want to be safe, we just track POSITION which occurs before SOURCE.
    }

    if (inItem && trimmedLine.startsWith('POSITION ')) {
        currentItemPos = parseFloat(trimmedLine.split(' ')[1]) || 0;
    }

    if (inSourceBlock && trimmedLine.startsWith('FILE ')) {
        const fileMatch = trimmedLine.match(/FILE\s+"([^"]+)"|FILE\s+([^\s]+)/);
        if (fileMatch) {
            const f = fileMatch[1] || fileMatch[2];
            const lowerF = f.toLowerCase();
            if (lowerF.match(/\.(wav|mp3|m4a|flac|aiff|ogg|mp4|mov|avi|mkv)$/)) {
                if (!isTrackMuted && !isItemMuted) {
                    const existing = result.audioFiles.find(a => a.path === f);
                    if (!existing) {
                        result.audioFiles.push({ path: f, offset: currentItemPos });
                    } else if (currentItemPos < existing.offset) {
                        existing.offset = currentItemPos;
                    }
                }
            }
        }
    }

    if (trimmedLine.startsWith('PROJOFFS ')) {
      result.offset = parseFloat(trimmedLine.split(' ')[1]) || 0;
    }

    if (trimmedLine.startsWith('MARKER ')) {
      const matchQuoted = trimmedLine.match(/MARKER\s+(\d+)\s+([\d.]+)\s+"([^"]*)"/);
      // Ensure the unquoted match doesn't capture flags/colors (e.g., '0' or '1' or 'R') by matching alphanumeric words if unquoted
      const matchUnquoted = trimmedLine.match(/MARKER\s+(\d+)\s+([\d.]+)\s+([a-zA-Z0-9_-]+)/);
      const match = matchQuoted || matchUnquoted;
      if (match) {
        result.mainMarkers.push({
          id:   parseInt(match[1], 10),
          time: parseFloat(match[2]),
          name: match[3] || ""
        });
      }
    }

    if (trimmedLine.startsWith('<TRACK ') || trimmedLine === '<TRACK') {
      currentTrack = { name: `Track ${result.tracks.length + 1}`, items: [] };
      result.tracks.push(currentTrack);
      trackDepth = blockDepth;
      isTrackMuted = false;
    }

    if (trimmedLine.startsWith('MUTE ') || trimmedLine.startsWith('MUTESOLO ')) {
      const muteVal = parseInt(trimmedLine.split(' ')[1], 10);
      if (inItem) {
          isItemMuted = (muteVal & 1) !== 0;
      } else if (currentTrack && !inItem) {
          isTrackMuted = (muteVal & 1) !== 0;
      }
    }

    if (trimmedLine === '>' && currentTrack && blockDepth < trackDepth) {
      currentTrack = null;
      trackDepth = -1;
    }

    if (currentTrack && !inItem && trimmedLine.startsWith('NAME ')) {
      const m = trimmedLine.match(/NAME\s+"([^"]*)"/);
      if (m) currentTrack.name = m[1];
    }

    if (currentTrack && trimmedLine === '<ITEM') {
      inItem = true;
      currentItem = { time: 0, name: '' };
      isItemMuted = false;
    }

    if (inItem && currentItem) {
      if (trimmedLine.startsWith('POSITION ')) {
        currentItem.time = parseFloat(trimmedLine.split(' ')[1]);
      }
      if (trimmedLine.startsWith('NAME ')) {
        const m = trimmedLine.match(/NAME\s+"([^"]*)"/);
        if (m) currentItem.name = m[1];
      }
    }

    if (inItem && trimmedLine === '>') {
      if (currentItem && currentItem.name) {
        currentTrack.items.push(currentItem);
      }
      inItem = false;
      currentItem = null;
    }
  }

  result.mainMarkers.sort((a, b) => a.time - b.time);
  result.tracks.forEach(t => t.items.sort((a, b) => a.time - b.time));

  if (result.audioFiles && result.audioFiles.length > 0) {
      result.audioFiles.sort((a, b) => a.offset - b.offset);
      result.audioFile = result.audioFiles[0].path;
  }

  return result;
}

console.log(JSON.stringify(parseReaperProject(fs.readFileSync('C:/Users/zokuse/Documents/CKS 2025 LS/CKS 2025 LS.rpp', 'utf-8')).audioFiles, null, 2));
