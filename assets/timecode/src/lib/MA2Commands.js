export function buildFollowUpCommands(sequenceIndex, options = {}) {
    const {
        label = null,
        executor = null,
        timecodeIndex = null,
        exportMode = 'main',
        parsedData = null
    } = options;

    const commands = [];

    function sanitizeQuotes(str) {
        return String(str).replace(/"/g, '');
    }

    if (parsedData) {
        const exportMain = exportMode.includes('main');
        const exportSub  = exportMode.includes('sub');
        
        let currentSeqIdx = sequenceIndex;
        
        if (exportMain && parsedData.mainMarkers.length > 0) {
            parsedData.mainMarkers.forEach((marker, index) => {
                const cueName = sanitizeQuotes(marker.name || `Cue ${index + 1}`);
                commands.push(`Store Sequence ${currentSeqIdx} Cue ${index + 1} "${cueName}" /merge /noconfirm`);
            });
            currentSeqIdx++;
        }
        
        if (exportSub) {
            parsedData.tracks.forEach((track, idx) => {
                if (track.items.length > 0) {
                    track.items.forEach((item, index) => {
                        const cueName = sanitizeQuotes(item.name || `Cue ${index + 1}`);
                        commands.push(`Store Sequence ${currentSeqIdx} Cue ${index + 1} "${cueName}" /merge /noconfirm`);
                    });
                    currentSeqIdx++;
                }
            });
        }
    }

    if (label) {
        commands.push(`Label Sequence ${sequenceIndex} "${sanitizeQuotes(label)}"`);
    }

    if (executor && executor.page && executor.number) {
        commands.push(`Assign Sequence ${sequenceIndex} At Executor ${executor.page}.${executor.number}`);
        if (timecodeIndex) {
            commands.push(`Assign Executor ${executor.page}.${executor.number} At Timecode ${timecodeIndex} Track 1`);
        }
    }

    return commands;
}
