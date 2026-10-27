// Session history (localStorage) and file export helpers.
const KEY = 'attentionai.history.v2';

export const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
};

export function saveSession(session) {
  const all = [session, ...loadHistory()].slice(0, 60);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
  return all;
}

export const clearHistory = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

const COLS = ['t', 'state', 'score', 'ear', 'bpm', 'perclos', 'yaw', 'pitch', 'roll', 'gx', 'gy'];
const HEAD = ['time_s', 'state', 'attention_score', 'eye_aspect_ratio', 'blinks_per_min', 'perclos', 'yaw_deg', 'pitch_deg', 'roll_deg', 'gaze_x', 'gaze_y'];

export function toCSV(samples) {
  return [HEAD.join(','), ...samples.map((s) => COLS.map((c) => s[c]).join(','))].join('\n');
}

export function download(name, text, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
