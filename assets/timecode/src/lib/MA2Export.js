import { secondsToFrames } from './TimecodeMath.js';

function escapeXML(str) {
  if (!str) return '';
  return String(str).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;',
    "'": '&apos;', '"': '&quot;'
  }[c]));
}

export function generateMA2XML(parsedData, exportMode, fps, customOffset, options = {}) {
  const {
    startSequenceIndex = 1,
    startTimecodeIndex = 1,
    tcName             = 'Generated TC',
    executor           = null
  } = options;

  const exportMain = exportMode.includes('main');
  const exportSub  = exportMode.includes('sub');
  const exportTc   = exportMode.includes('tc');

  const now = new Date().toISOString().split('.')[0];
  const offsetTime = (customOffset !== null && customOffset !== undefined) ? customOffset : parsedData.offset;

  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<MA xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" `;
  xml += `xmlns="http://schemas.malighting.de/grandma2/xml/MA" `;
  xml += `xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA `;
  xml += `http://schemas.malighting.de/grandma2/xml/3.9.60/MA.xsd" `;
  xml += `major_vers="3" minor_vers="9" stream_vers="60">\n`;
  xml += `  <Info datetime="${now}" showfile="Timecode Creator" />\n`;

  let seqIdx    = startSequenceIndex;
  let seqMap    = {}; 

  if (exportMain && parsedData.mainMarkers.length > 0) {
    seqMap['__main__'] = seqIdx++;
  }

  if (exportSub) {
    parsedData.tracks.forEach((track, idx) => {
      if (track.items.length > 0) {
        seqMap[`track_${idx}`] = seqIdx++;
      }
    });
  }

  if (exportTc) {
    let maxFrames = 0;
    if (exportMain) {
      parsedData.mainMarkers.forEach(item => {
        const frames = secondsToFrames(offsetTime + item.time, fps);
        if (frames > maxFrames) maxFrames = frames;
      });
    }
    if (exportSub) {
      parsedData.tracks.forEach(track => {
        track.items.forEach(item => {
          const frames = secondsToFrames(offsetTime + item.time, fps);
          if (frames > maxFrames) maxFrames = frames;
        });
      });
    }
    const tcLenght = maxFrames + (fps * 5); // Add 5 seconds padding
    
    xml += `  <Timecode index="${startTimecodeIndex}" name="${escapeXML(tcName)}" lenght="${tcLenght}" offset="0" slot="Link Selected" runs="1" no_switch_off="true" no_status_call="true" frame_format="${fps} FPS">\n`;

    let trackIdx = 0;

    if (exportMain && parsedData.mainMarkers.length > 0) {
      xml += buildTrackXML(trackIdx++, seqMap['__main__'], 'Main Cues', parsedData.mainMarkers, offsetTime, fps, executor);
    }

    if (exportSub) {
      parsedData.tracks.forEach((track, idx) => {
        const mappedSeq = seqMap[`track_${idx}`];
        if (track.items.length > 0 && mappedSeq) {
          xml += buildTrackXML(trackIdx++, mappedSeq, track.name, track.items, offsetTime, fps, null);
        }
      });
    }

    xml += `  </Timecode>\n`;
  }

  xml += `</MA>\n`;
  return xml;
}



function buildTrackXML(trackIndex, sequenceIndex, name, items, offsetTime, fps, executor) {
  let out = `    <Track index="${trackIndex}" name="${escapeXML(name)}" active="true" expanded="true">\n`;
  
  if (executor && executor.page && executor.number) {
      out += `      <Object><No>30</No><No>1</No><No>${executor.page}</No><No>${executor.number}</No></Object>\n`;
  } else {
      out += `      <Object name="${escapeXML(name)}" class="Sequence">19.${sequenceIndex}</Object>\n`;
  }
  
  out += `      <SubTrack index="0">\n`;

  items.forEach((item, i) => {
    const totalSec = offsetTime + item.time;
    const frames   = secondsToFrames(totalSec, fps);
    out += `        <Event index="${i}" time="${frames}" command="Go" pressed="true" step="${i + 1}">`;
    out += `<Cue name=""><No>${sequenceIndex}</No><No>1</No><No>${i + 1}</No></Cue></Event>\n`;
  });

  out += `      </SubTrack>\n`;
  out += `    </Track>\n`;
  return out;
}
