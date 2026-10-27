// Tiny dependency-free canvas charts that follow the current theme.
const css = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
const KEYS = { focused: '--focus', distracted: '--drift', drowsy: '--drowse', away: '--away' };
export const stateColor = (s) => css(KEYS[s] || '--away');

function setup(canvas) {
  const r = canvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
  }
  const c = canvas.getContext('2d');
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
  return { c, w, h };
}

export function drawDonut(canvas, totals) {
  const { c, w, h } = setup(canvas);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
  c.lineWidth = 14; c.lineCap = 'round';
  c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.strokeStyle = css('--line'); c.stroke();
  if (sum <= 0) return;
  let a = -Math.PI / 2;
  for (const k of ['focused', 'distracted', 'drowsy', 'away']) {
    const f = totals[k] / sum; if (f < 0.004) continue;
    const e = a + f * Math.PI * 2;
    c.beginPath(); c.arc(cx, cy, R, a + 0.05, Math.max(a + 0.06, e - 0.05));
    c.strokeStyle = stateColor(k); c.stroke(); a = e;
  }
}

export function drawTimeline(canvas, samples, span = 300) {
  const { c, w, h } = setup(canvas);
  c.font = '13px ' + css('--body'); c.fillStyle = css('--muted');
  if (samples.length < 2) { c.fillText('Your attention timeline fills in as the session runs.', 0, h / 2); return; }
  const end = samples[samples.length - 1].t, t0 = Math.max(0, end - span), t1 = Math.max(end, t0 + 30);
  const x = (t) => ((t - t0) / (t1 - t0)) * w;
  const y = (s) => h - 8 - (s / 100) * (h - 16);
  const vis = samples.filter((s) => s.t >= t0);
  vis.forEach((s, i) => {
    const nx = i < vis.length - 1 ? x(vis[i + 1].t) : x(s.t) + 3;
    c.globalAlpha = 0.2; c.fillStyle = stateColor(s.state); c.fillRect(x(s.t), 0, Math.max(2, nx - x(s.t)), h);
  });
  c.globalAlpha = 1;
  c.beginPath(); vis.forEach((s, i) => (i ? c.lineTo(x(s.t), y(s.score)) : c.moveTo(x(s.t), y(s.score))));
  c.strokeStyle = css('--text'); c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  const last = vis[vis.length - 1];
  c.beginPath(); c.arc(x(last.t), y(last.score), 4.5, 0, Math.PI * 2); c.fillStyle = stateColor(last.state); c.fill();
}

export function drawBars(canvas, items) {
  const { c, w, h } = setup(canvas);
  c.font = '12px ' + css('--body'); c.textAlign = 'center';
  if (!items.length) { c.fillStyle = css('--muted'); c.textAlign = 'left'; c.fillText('Finish a session to see your trend.', 0, h / 2); return; }
  const gap = 8, bw = Math.min(36, (w - gap * (items.length - 1)) / items.length), total = items.length * bw + (items.length - 1) * gap;
  items.forEach((it, i) => {
    const x = (w - total) / 2 + i * (bw + gap), bh = Math.max(3, (it.value / 100) * (h - 28));
    c.fillStyle = css('--focus'); c.globalAlpha = 0.3 + 0.7 * (it.value / 100);
    c.beginPath(); c.roundRect(x, h - 20 - bh, bw, bh, 6); c.fill(); c.globalAlpha = 1;
    c.fillStyle = css('--muted'); c.fillText(it.label, x + bw / 2, h - 4);
  });
}
