// Settings, sensitivity presets and persistence.
export const PRESETS = {
  relaxed:  { yawLimit: 35, pitchLimit: 28, gazeLimit: 0.60 },
  balanced: { yawLimit: 25, pitchLimit: 20, gazeLimit: 0.45 },
  strict:   { yawLimit: 18, pitchLimit: 14, gazeLimit: 0.32 },
};

export const DEFAULTS = {
  preset: 'balanced',
  ...PRESETS.balanced,
  distractDelay: 2.5,  // seconds of looking away before "Distracted"
  alarmDelay: 5,       // extra seconds of distraction before the alarm sounds
  awayDelay: 3,        // seconds without a face before "Away"
  perclos: 0.3,        // share of the last 30s with eyes closed that means "Drowsy"
  microsleep: 1.2,     // continuous eye closure (s) that means "Drowsy"
  volume: 0.6,
  alarm: true,
  mesh: true,
  theme: 'dark',
};

// If the head-pose pad moves the wrong way on your device, flip a sign here.
export const HEAD_SIGN = { yaw: 1, pitch: 1 };

const KEY = 'attentionai.settings.v2';

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
