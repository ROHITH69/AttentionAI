// Pure attention logic. No DOM, no camera - easy to test.
// Feed it one feature frame at a time; it returns the current state and metrics.

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class AttentionEngine {
  constructor(settings) {
    this.s = settings; // live reference: changing settings applies instantly
    this.base = { yaw: 0, pitch: 0, gx: 0, gy: 0, ear: 0.28 };
    this.reset();
  }

  reset() {
    this.state = 'focused';
    this.score = 100;
    this.lastT = null; this.t0 = null;
    this.noFaceSince = null;
    this.offSince = null; this.lastOff = 0;
    this.closedSince = null; this.closeStart = 0; this.wasClosed = false;
    this.log = []; this.blinks = []; this.yawns = [];
    this.jawSince = null; this.yawnArmed = true;
    this.lastDrowsy = -Infinity;
  }

  /** Learn the user's "looking at the screen" baseline from a few seconds of frames. */
  calibrate(frames) {
    const ok = frames.filter((f) => f.face);
    if (ok.length < 15) return false;
    const m = (k) => median(ok.map((f) => f[k]));
    const open = ok.filter((f) => (f.blinkScore ?? 0) < 0.3);
    this.base = {
      yaw: m('yaw'), pitch: m('pitch'), gx: m('gx'), gy: m('gy'),
      ear: median((open.length ? open : ok).map((f) => f.ear)) || 0.28,
    };
    return true;
  }

  update(f, t) {
    const s = this.s, b = this.base;
    this.t0 ??= t;
    const dt = this.lastT == null ? 0 : Math.min(t - this.lastT, 0.25);
    this.lastT = t;
    const k = 1 - Math.exp(-dt / 0.8);

    if (!f.face) {
      this.noFaceSince ??= t;
      this.wasClosed = false; this.closedSince = null; this.offSince = null;
      if (t - this.noFaceSince >= s.awayDelay) this.state = 'away';
      this.score += (0 - this.score) * k * 0.6;
      return this._out(t, f, { closed: false, headDev: 0, gazeDev: 0, conf: 0.9 });
    }
    this.noFaceSince = null;

    const yaw = f.yaw - b.yaw, pitch = f.pitch - b.pitch;
    const gx = f.gx - b.gx, gy = f.gy - b.gy;
    const closed = f.blinkScore != null ? f.blinkScore > 0.55 : f.ear < b.ear * 0.6;

    // Blinks and eye-closure tracking
    if (closed && !this.wasClosed) { this.closeStart = t; this.closedSince = t; }
    if (!closed && this.wasClosed) {
      const d = t - this.closeStart;
      if (d > 0.04 && d < 0.5) this.blinks.push(t);
      this.closedSince = null;
    }
    this.wasClosed = closed;
    this.log.push({ t, c: closed ? 1 : 0 });
    while (this.log.length && t - this.log[0].t > 30) this.log.shift();
    while (this.blinks.length && t - this.blinks[0] > 60) this.blinks.shift();

    // Yawns: mouth wide open for over a second
    if ((f.jaw ?? 0) > 0.6) {
      this.jawSince ??= t;
      if (t - this.jawSince > 1 && this.yawnArmed) { this.yawns.push(t); this.yawnArmed = false; }
    } else if ((f.jaw ?? 0) < 0.35) { this.jawSince = null; this.yawnArmed = true; }

    // Deviation from the calibrated baseline (1.0 = at the limit)
    const headDev = Math.max(Math.abs(yaw) / s.yawLimit, Math.abs(pitch) / s.pitchLimit);
    const gazeDev = closed ? 0 : Math.max(Math.abs(gx) / s.gazeLimit, Math.abs(gy) / (s.gazeLimit * 1.2));
    const off = headDev > 1 || gazeDev > 1;
    if (off) { this.lastOff = t; this.offSince ??= t; }
    else if (this.offSince != null && t - this.lastOff > 0.7) this.offSince = null; // short grace period

    const perclos = this._perclos();
    const micro = this.closedSince != null && t - this.closedSince >= s.microsleep;
    const warmed = t - this.t0 >= 8;
    const recentYawns = this.yawns.filter((y) => t - y < 300).length;
    if (micro || (warmed && perclos > s.perclos) || (recentYawns >= 3 && perclos > 0.15)) this.lastDrowsy = t;

    const drowsy = t - this.lastDrowsy < 3;
    const distracted = this.offSince != null && t - this.offSince >= s.distractDelay;
    this.state = drowsy ? 'drowsy' : distracted ? 'distracted' : 'focused';

    const dev = Math.min(1, Math.max(headDev, gazeDev));
    const target = drowsy ? 10 : distracted ? 25 : 100 - 60 * dev;
    this.score += (target - this.score) * k;

    const raw = Math.max(headDev, gazeDev);
    const conf = drowsy ? Math.min(1, 0.6 + perclos)
      : distracted ? Math.min(1, 0.6 + 0.4 * Math.min(1, raw - 1))
      : 1 - 0.5 * dev;
    return this._out(t, f, { closed, headDev, gazeDev, conf, yaw, pitch, gx, gy });
  }

  _perclos() {
    if (this.log.length < 5) return 0;
    let c = 0; for (const e of this.log) c += e.c;
    return c / this.log.length;
  }

  _bpm(t) {
    const el = t - (this.t0 ?? t), n = this.blinks.length;
    return Math.round(el >= 60 ? n : el > 10 ? (n * 60) / el : n);
  }

  _out(t, f, x) {
    return {
      t, state: this.state, score: this.score, conf: x.conf ?? 0.9,
      closed: x.closed, headDev: x.headDev, gazeDev: x.gazeDev,
      ear: f.ear ?? 0, blinkScore: f.blinkScore ?? 0,
      bpm: this._bpm(t), perclos: this._perclos(), yawns: this.yawns.length,
      yaw: x.yaw ?? 0, pitch: x.pitch ?? 0, roll: f.roll ?? 0, gx: x.gx ?? 0, gy: x.gy ?? 0,
    };
  }
}
