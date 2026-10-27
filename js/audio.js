// Alert sounds are synthesised with the Web Audio API - no audio files needed.
export class AlertSound {
  constructor() { this.ctx = null; this.volume = 0.6; this.muted = false; this.timer = null; this.t0 = 0; }

  /** Must be called from a user gesture (e.g. the Start button). */
  unlock() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
    } catch { /* audio unsupported */ }
  }

  tone(freq, dur, when = 0, type = 'sine', gain = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    const v = Math.max(0.0002, this.volume * gain * 0.4);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** kind: 'distracted' (gentle two-note chime) or 'drowsy' (urgent triple beep). Gets louder over time. */
  start(kind) {
    this.stop();
    this.t0 = performance.now();
    const play = () => {
      const esc = Math.min(1.6, 1 + (performance.now() - this.t0) / 15000);
      if (kind === 'drowsy') [0, 0.18, 0.36].forEach((w) => this.tone(880, 0.14, w, 'square', 0.8 * esc));
      else { this.tone(523, 0.25, 0, 'sine', esc); this.tone(659, 0.3, 0.22, 'sine', esc); }
    };
    play();
    this.timer = setInterval(play, kind === 'drowsy' ? 1000 : 1600);
  }

  stop() { clearInterval(this.timer); this.timer = null; }
  chime() { this.tone(659, 0.18, 0); this.tone(880, 0.3, 0.14); }
  setVolume(v) { this.volume = v; }
}
