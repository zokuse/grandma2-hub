export function secondsToFrames(seconds, fps) {
  return Math.floor(seconds * fps);
}

export function parseOffset(offsetStr, fps = 30) {
  const parts = offsetStr.split(':');
  if (parts.length < 3) return 0;

  const h   = parseInt(parts[0], 10) || 0;
  const m   = parseInt(parts[1], 10) || 0;
  const s_f = parts[2].split('.');
  const s   = parseInt(s_f[0], 10)   || 0;
  const f   = s_f.length > 1 ? parseInt(s_f[1], 10) : 0;

  return (h * 3600) + (m * 60) + s + (f / fps);
}

export function formatTimecodeString(seconds, fps) {
  const pad = (n, len) => String(n).padStart(len, '0');
  const f = Math.floor((seconds % 1) * fps);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(f, 2)}`;
}
