// Draws the face HUD (corner brackets, iris glow, subtle mesh) on the canvas above the video.
export function drawOverlay(canvas, f, color, mesh, shapes) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);
  if (!f?.face) return;
  const lm = f.lm;
  if (!lm) return; // demo frames carry no landmarks

  if (mesh && shapes) {
    c.lineWidth = Math.max(1, W / 700); c.strokeStyle = color; c.globalAlpha = 0.4;
    for (const set of [shapes.oval, shapes.eyeL, shapes.eyeR, shapes.lips]) {
      if (!set) continue;
      c.beginPath();
      for (const { start, end } of set) { c.moveTo(lm[start].x * W, lm[start].y * H); c.lineTo(lm[end].x * W, lm[end].y * H); }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  for (const i of [468, 473]) {
    const p = lm[i]; if (!p) continue;
    c.beginPath(); c.arc(p.x * W, p.y * H, Math.max(3, W / 200), 0, Math.PI * 2);
    c.fillStyle = color; c.shadowColor = color; c.shadowBlur = 14; c.fill(); c.shadowBlur = 0;
  }

  const b = f.box, pad = 0.025;
  const x0 = (b.x0 - pad) * W, y0 = (b.y0 - pad) * H, x1 = (b.x1 + pad) * W, y1 = (b.y1 + pad) * H;
  const len = Math.min(x1 - x0, y1 - y0) * 0.18;
  c.strokeStyle = color; c.lineWidth = Math.max(3, W / 320); c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(x0, y0 + len); c.lineTo(x0, y0); c.lineTo(x0 + len, y0);
  c.moveTo(x1 - len, y0); c.lineTo(x1, y0); c.lineTo(x1, y0 + len);
  c.moveTo(x0, y1 - len); c.lineTo(x0, y1); c.lineTo(x0 + len, y1);
  c.moveTo(x1 - len, y1); c.lineTo(x1, y1); c.lineTo(x1, y1 - len);
  c.stroke();
}
