// AttentionAI v2 - app controller: wires camera, detection, UI, alerts and history together.
import { loadSettings, saveSettings, PRESETS, DEFAULTS, HEAD_SIGN } from './config.js';
import { Detector } from './detector.js';
import { AttentionEngine } from './classifier.js';
import { AlertSound } from './audio.js';
import { drawDonut, drawTimeline, drawBars, stateColor } from './charts.js';
import { drawOverlay } from './overlay.js';
import { saveSession, loadHistory, clearHistory, toCSV, download } from './storage.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const settings = loadSettings();
const audio = new AlertSound();
const engine = new AttentionEngine(settings);
const detector = new Detector();
const demo = new URLSearchParams(location.search).has('demo');

const video = $('#cam'), overlay = $('#overlay');
const LABEL = { focused: 'Focused', distracted: 'Distracted', drowsy: 'Drowsy', away: 'Away' };
const MSG = {
  focused: "You're locked in. Keep going.",
  distracted: 'Your attention drifted. Look back at the screen.',
  drowsy: 'Your eyes look tired. Stand up, stretch or get some water.',
  away: "I can't see you. Move back into the frame.",
};
const BANNER = {
  distracted: 'Look at the screen to stop the alarm',
  drowsy: 'Drowsiness detected. Take a breath, stretch, or step away for a minute.',
};

let run = { on: false, paused: false, calibrating: false };
let raf = 0, S = null, lastUi = 0, lastChart = 0, fpsCount = 0, fpsT = 0;
let calib = { frames: [], end: 0 };
let alarm = { start: null, on: false, kind: null, dismissed: false };

/* ---------- helpers ---------- */
function toast(text) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
  $('#toasts').append(el); setTimeout(() => el.remove(), 3700);
}
const fmtTime = (s) => { s = Math.floor(s); const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s` : `${Math.floor(s)}s`);
const pct = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
const newSession = () => ({
  start: Date.now(), elapsed: 0, lastT: null, lastSample: 0, totals: { focused: 0, distracted: 0, drowsy: 0, away: 0 },
  samples: [], streak: 0, best: 0, distr: 0, longest: 0, alerts: 0, scoreSum: 0, milestone: 60,
});

function setEyes(el, px, py, lid) {
  el.style.setProperty('--px', px); el.style.setProperty('--py', py); el.style.setProperty('--lid', lid);
}
function view(name) {
  $('#landing').hidden = name !== 'landing';
  $('#app').hidden = name !== 'app';
  document.body.dataset.state = name === 'landing' ? 'idle' : document.body.dataset.state;
}

/* ---------- landing eyes follow the pointer and blink ---------- */
const heroEyes = $('#heroEyes');
addEventListener('pointermove', (e) => {
  if (!$('#landing').hidden) {
    const r = heroEyes.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2), dy = (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2);
    setEyes(heroEyes, clamp(dx * 1.6, -1, 1), clamp(dy * 1.6, -1, 1), heroEyes.style.getPropertyValue('--lid') || 0);
  }
});
(function blinkLoop() {
  setTimeout(() => {
    if (!$('#landing').hidden) { heroEyes.style.setProperty('--lid', 1); setTimeout(() => heroEyes.style.setProperty('--lid', 0), 130); }
    blinkLoop();
  }, 2200 + Math.random() * 3000);
})();

/* ---------- session lifecycle ---------- */
function failStart(e) {
  const m = {
    NotAllowedError: 'Camera access was blocked. Allow the camera in your browser address bar, then try again.',
    NotFoundError: 'No camera found. Connect a webcam and try again.',
    NotReadableError: 'Your camera is being used by another app. Close it and try again.',
    InsecureContext: 'The camera needs a secure page. Open this app over https:// or http://localhost.',
  }[e?.name] || `Could not start: ${e?.message || e}. Check your connection and try again.`;
  detector.stop(); view('landing'); toast(m); console.error(e);
}

async function startSession(isDemo) {
  audio.unlock(); audio.setVolume(settings.volume);
  view('app'); $('#loading').hidden = false; $('#calib').hidden = true;
  $('#loadingText').textContent = 'Starting up…';
  document.body.dataset.state = 'idle';
  try {
    if (!isDemo) {
      await detector.init((t) => ($('#loadingText').textContent = t));
      $('#loadingText').textContent = 'Waiting for camera permission…';
      await detector.startCamera(video);
      overlay.width = video.videoWidth || 1280; overlay.height = video.videoHeight || 720;
    }
  } catch (e) { failStart(e); return; }
  $('#loading').hidden = true;
  S = newSession(); engine.reset(); resetAlarm(); resetUi();
  run = { on: true, paused: false, calibrating: false };
  beginCalibration();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  document.title = 'AttentionAI - session running';
}

function beginCalibration() {
  run.calibrating = true; calib = { frames: [], end: performance.now() / 1000 + 3 };
  $('#calib').hidden = false; $('#calibText').textContent = 'Look at the screen and sit the way you normally work.';
}

function endSession() {
  if (!run.on) return;
  run.on = false; cancelAnimationFrame(raf); audio.stop(); detector.stop(); hideBanner();
  if (S && S.elapsed >= 10) {
    saveSession({
      date: S.start, dur: Math.round(S.elapsed), focus: pct(S.totals.focused, S.elapsed), drowsy: pct(S.totals.drowsy, S.elapsed),
      avg: Math.round(S.scoreSum / S.elapsed), best: Math.round(S.best), longest: Math.round(S.longest), alerts: S.alerts,
    });
    toast(`Session saved: ${pct(S.totals.focused, S.elapsed)}% focused over ${fmtDur(S.elapsed)}.`);
  }
  drawOverlay(overlay, null); view('landing'); document.title = 'AttentionAI - know when your focus drifts';
}

/* ---------- main loop ---------- */
function demoFrame(t) {
  const p = t % 40; let yaw = Math.sin(t * 0.8) * 4, gx = Math.sin(t * 0.5) * 0.08, bs = 0.05;
  if (p > 14 && p < 22) { yaw = 38; gx = 0.5; } else if (p > 30 && p < 36) bs = 0.9;
  if (Math.floor(t * 10) % 40 === 0) bs = Math.max(bs, 0.9);
  return { face: true, ear: 0.3 - bs * 0.18, blinkScore: bs, yaw, pitch: Math.cos(t * 0.6) * 3, roll: Math.sin(t * 0.3) * 2, gx, gy: 0, jaw: 0 };
}

function tick() {
  if (!run.on) return;
  raf = requestAnimationFrame(tick);
  if (run.paused) return;
  const now = performance.now() / 1000;
  const f = demo ? demoFrame(now) : detector.detect();
  if (!f) return;

  fpsCount++;
  if (now - fpsT >= 1) { $('#fps').textContent = `${fpsCount} fps`; fpsCount = 0; fpsT = now; }
  drawOverlay(overlay, f, stateColor(document.body.dataset.state === 'idle' ? 'focused' : document.body.dataset.state), settings.mesh, detector.shapes);

  if (run.calibrating) { runCalibration(f, now); return; }

  const res = engine.update(f, now);
  account(res, now);
  handleAlarm(res, now);
  if (now - lastUi >= 0.1) { lastUi = now; updateUi(res); }
  if (now - lastChart >= 1) { lastChart = now; updateCharts(); }
}

function runCalibration(f, now) {
  calib.frames.push(f);
  const left = Math.max(0, calib.end - now);
  $('#calibNum').textContent = Math.ceil(left) || 0;
  $('#calib .calib-ring').style.setProperty('--p', ((3 - left) / 3) * 100);
  if (left > 0) return;
  if (demo || engine.calibrate(calib.frames)) {
    run.calibrating = false; $('#calib').hidden = true; S.lastT = null; engine.lastT = null;
    toast('Calibrated. Your session has started.');
  } else {
    calib = { frames: [], end: now + 3 };
    $('#calibText').textContent = "I can't see your face clearly. Face the camera in good light.";
  }
}

function account(res, now) {
  const dt = S.lastT == null ? 0 : Math.min(now - S.lastT, 0.25); S.lastT = now;
  S.elapsed += dt; S.totals[res.state] += dt; S.scoreSum += res.score * dt;
  if (res.state === 'focused') {
    S.streak += dt; S.best = Math.max(S.best, S.streak);
    if (S.streak >= S.milestone) { S.milestone += 60; toast(`${fmtDur(S.streak)} of deep focus. Nice.`); audio.chime(); }
  } else { S.streak = 0; S.milestone = 60; }
  if (res.state === 'distracted' || res.state === 'drowsy') { S.distr += dt; S.longest = Math.max(S.longest, S.distr); } else S.distr = 0;
  if (now - S.lastSample >= 1) {
    S.lastSample = now;
    const r = (v, n = 2) => +v.toFixed(n);
    S.samples.push({ t: r(S.elapsed, 1), state: res.state, score: Math.round(res.score), ear: r(res.ear, 3), bpm: res.bpm,
      perclos: r(res.perclos), yaw: r(res.yaw, 1), pitch: r(res.pitch, 1), roll: r(res.roll, 1), gx: r(res.gx), gy: r(res.gy) });
  }
}

/* ---------- alarm ---------- */
function resetAlarm() { audio.stop(); alarm = { start: null, on: false, kind: null, dismissed: false }; hideBanner(); }
function showBanner(kind) { $('#bannerText').textContent = BANNER[kind]; $('#banner').hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

function handleAlarm(res, now) {
  const st = res.state;
  if (st === 'distracted' || st === 'drowsy') {
    alarm.start ??= now;
    const need = st === 'drowsy' ? 0 : settings.alarmDelay;
    if (alarm.on && alarm.kind !== st) { alarm.on = false; }  // escalate / switch sound
    if (!alarm.on && !alarm.dismissed && now - alarm.start >= need) {
      alarm.on = true; alarm.kind = st; S.alerts++;
      showBanner(st); if (settings.alarm) audio.start(st); navigator.vibrate?.(200);
    }
  } else if (st === 'focused') {
    if (alarm.on) audio.chime();
    resetAlarm();
  } else { audio.stop(); alarm.start = null; alarm.on = false; hideBanner(); }
}

/* ---------- UI updates ---------- */
function resetUi() { lastUi = lastChart = 0; updateCharts(); }

function updateUi(res) {
  const st = res.state;
  document.body.dataset.state = st;
  $('#stateName').textContent = LABEL[st]; $('#stateTag').textContent = LABEL[st]; $('#stateMsg').textContent = MSG[st];
  const conf = Math.round(res.conf * 100);
  $('#confBar').style.width = conf + '%'; $('#confText').textContent = `Confidence ${conf}%`;
  const sc = Math.round(res.score);
  $('#scoreRing').style.setProperty('--score', sc); $('#scoreNum').textContent = sc;
  $('#tEar').textContent = res.ear.toFixed(2); $('#tBlink').textContent = res.bpm;
  $('#tPerclos').textContent = Math.round(res.perclos * 100) + '%'; $('#tYawn').textContent = res.yawns;

  // Head pose pad
  const lim = (v, l) => clamp(v / l, -1, 1) * 38;
  const pad = $('#pad');
  pad.style.setProperty('--x', `${-lim(res.yaw * HEAD_SIGN.yaw, settings.yawLimit)}px`);
  pad.style.setProperty('--y', `${lim(res.pitch * HEAD_SIGN.pitch, settings.pitchLimit)}px`);
  $('#pYaw').textContent = Math.round(res.yaw) + '°'; $('#pPitch').textContent = Math.round(res.pitch) + '°'; $('#pRoll').textContent = Math.round(res.roll) + '°';

  // Gaze label + animated eyes mirror what the camera sees
  const h = Math.abs(res.gx) > 0.2 ? (res.gx > 0 ? 'Right' : 'Left') : '', v = Math.abs(res.gy) > 0.2 ? (res.gy > 0 ? 'Up' : 'Down') : '';
  $('#gazeLabel').textContent = st === 'away' ? 'No face' : (v + (v && h ? ' ' : '') + h) || 'Center';
  setEyes($('#eyes'), clamp(res.gx * 2.2, -1, 1), clamp(-res.gy * 2.2, -1, 1), st === 'away' ? 1 : Math.max(res.blinkScore, st === 'drowsy' ? 0.5 : 0));

  // Summary
  const el = S.elapsed, tt = S.totals;
  $('#sTime').textContent = fmtTime(el);
  $('#pctFocus').textContent = pct(tt.focused, el) + '%';
  $('#lgFocus').textContent = pct(tt.focused, el) + '%'; $('#lgDrift').textContent = pct(tt.distracted, el) + '%';
  $('#lgDrowse').textContent = pct(tt.drowsy, el) + '%'; $('#lgAway').textContent = pct(tt.away, el) + '%';
  $('#sBest').textContent = fmtDur(S.best); $('#sLongest').textContent = fmtDur(S.longest);
  $('#sAvg').textContent = el > 0 ? Math.round(S.scoreSum / el) : 0; $('#sAlerts').textContent = S.alerts;
  document.title = st === 'focused' ? 'AttentionAI - focused' : `${LABEL[st]} - AttentionAI`;
}

function updateCharts() {
  if (!S) return;
  drawDonut($('#donut'), S.totals); drawTimeline($('#timeline'), S.samples);
}

/* ---------- controls ---------- */
$('#btnStart').onclick = () => startSession(false);
$('#btnDemo').onclick = () => startSession(true);
$('#btnEnd').onclick = endSession;
$('#bannerClose').onclick = () => { audio.stop(); alarm.dismissed = true; alarm.on = false; hideBanner(); };
$('#btnCalib').onclick = () => { if (run.on) beginCalibration(); };

function togglePause() {
  if (!run.on) return;
  run.paused = !run.paused; audio.stop();
  $('#btnPause').textContent = run.paused ? 'Resume' : 'Pause';
  $('#stageNote').hidden = !run.paused; $('#stageNote').textContent = 'Paused';
  if (!run.paused) { S.lastT = null; engine.lastT = null; }
}
$('#btnPause').onclick = togglePause;

function toggleMute() {
  audio.muted = !audio.muted; if (audio.muted) audio.stop();
  $('#btnMute').textContent = audio.muted ? 'Unmute alarm' : 'Mute alarm';
}
$('#btnMute').onclick = toggleMute;

$('#btnReset').onclick = () => { if (!run.on) return; S = newSession(); engine.reset(); resetAlarm(); updateCharts(); toast('Stats reset.'); };
$('#btnCSV').onclick = () => {
  if (!S?.samples.length) return toast('Nothing to export yet. Let the session run a few seconds.');
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  download(`attentionai-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.csv`, toCSV(S.samples));
};

addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog[open]') || e.metaKey || e.ctrlKey || $('#app').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.key === 'm') toggleMute();
  else if (e.key === 'c') $('#btnCalib').click();
});
addEventListener('resize', () => run.on && updateCharts());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && run.on) toast('Tip: keep this tab visible. Browsers slow down hidden tabs.');
});

/* ---------- theme ---------- */
function applyTheme(t) { document.body.dataset.theme = t; settings.theme = t; saveSettings(settings); run.on && updateCharts(); }
$('#btnTheme').onclick = () => applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
applyTheme(settings.theme);

/* ---------- settings ---------- */
const sets = [['#setDistract', 'distractDelay', 's'], ['#setAlarmDelay', 'alarmDelay', 's'], ['#setVolume', 'volume', '']];
function syncSettingsUi() {
  $('#setPreset').value = settings.preset;
  for (const [id, key, u] of sets) {
    $(id).value = settings[key];
    $(id + 'Val').textContent = key === 'volume' ? Math.round(settings[key] * 100) + '%' : settings[key] + u;
  }
  $('#setAlarm').checked = settings.alarm; $('#setMesh').checked = settings.mesh;
}
$('#btnSettings').onclick = () => { syncSettingsUi(); $('#dlgSettings').showModal(); };
$('#setPreset').onchange = (e) => { Object.assign(settings, PRESETS[e.target.value], { preset: e.target.value }); saveSettings(settings); };
for (const [id, key] of sets) {
  $(id).oninput = (e) => { settings[key] = +e.target.value; if (key === 'volume') audio.setVolume(settings.volume); saveSettings(settings); syncSettingsUi(); };
}
$('#setAlarm').onchange = (e) => { settings.alarm = e.target.checked; if (!settings.alarm) audio.stop(); saveSettings(settings); };
$('#setMesh').onchange = (e) => { settings.mesh = e.target.checked; saveSettings(settings); };
$('#btnTestSound').onclick = () => { audio.unlock(); audio.setVolume(settings.volume); audio.chime(); };
$('#btnResetSettings').onclick = () => { Object.assign(settings, DEFAULTS, { theme: settings.theme }); saveSettings(settings); syncSettingsUi(); toast('Settings restored.'); };

/* ---------- history ---------- */
function renderHistory() {
  const h = loadHistory(), list = $('#histList'); list.replaceChildren();
  if (!h.length) list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No sessions yet. Finish one and it shows up here.' }));
  for (const s of h) {
    const li = document.createElement('li'), d = new Date(s.date);
    li.innerHTML = '<span></span><span></span>';
    li.children[0].textContent = d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    li.children[1].innerHTML = `<b>${+s.focus || 0}%</b> focused · ${fmtDur(+s.dur || 0)} · score ${+s.avg || 0}`;
    list.append(li);
  }
  requestAnimationFrame(() => drawBars($('#histChart'), h.slice(0, 14).reverse().map((s, i) => ({ value: +s.focus || 0, label: String(i + 1) }))));
}
$('#btnHistory').onclick = () => { $('#dlgHistory').showModal(); renderHistory(); };
$('#btnClearHist').onclick = () => { clearHistory(); renderHistory(); toast('History cleared.'); };

if (demo) toast('Demo mode: simulated data, no camera used.');
