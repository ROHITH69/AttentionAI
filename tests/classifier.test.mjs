// Run: node tests/classifier.test.mjs
import assert from 'node:assert/strict';
import { AttentionEngine } from '../js/classifier.js';
import { DEFAULTS } from '../js/config.js';

const open = (o = {}) => ({ face: true, ear: 0.3, blinkScore: 0.05, yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0, jaw: 0, ...o });
function run(engine, secs, frame, t0) {
  let r; for (let t = t0; t < t0 + secs; t += 1 / 30) r = engine.update(typeof frame === 'function' ? frame(t - t0) : frame, t);
  return r;
}
const mk = () => { const e = new AttentionEngine({ ...DEFAULTS }); e.calibrate(Array.from({ length: 60 }, () => open())); return e; };

{ // focused stays focused, including normal blinks
  const e = mk();
  const r = run(e, 12, (t) => open(Math.floor(t * 10) % 40 === 0 ? { blinkScore: 0.9 } : {}), 0);
  assert.equal(r.state, 'focused'); assert.ok(r.score > 90); assert.ok(r.bpm >= 1);
}
{ // turning the head away becomes distracted only after the delay
  const e = mk(); run(e, 3, open(), 0);
  assert.equal(run(e, 1, open({ yaw: 40 }), 3).state, 'focused');
  assert.equal(run(e, 3, open({ yaw: 40 }), 4).state, 'distracted');
  assert.equal(run(e, 2, open(), 7).state, 'focused');
}
{ // looking sideways with the eyes only also counts
  const e = mk(); run(e, 3, open(), 0);
  assert.equal(run(e, 4, open({ gx: 0.8 }), 3).state, 'distracted');
}
{ // a long eye closure is drowsy
  const e = mk(); run(e, 3, open(), 0);
  assert.equal(run(e, 2.5, open({ blinkScore: 0.95, ear: 0.05 }), 3).state, 'drowsy');
}
{ // no face means away after the delay
  const e = mk(); run(e, 3, open(), 0);
  assert.equal(run(e, 1, { face: false }, 3).state, 'focused');
  assert.equal(run(e, 4, { face: false }, 4).state, 'away');
}
{ // calibration removes a constant offset (camera mounted off-axis)
  const e = new AttentionEngine({ ...DEFAULTS });
  assert.ok(e.calibrate(Array.from({ length: 60 }, () => open({ yaw: 15, pitch: -10 }))));
  assert.equal(run(e, 6, open({ yaw: 15, pitch: -10 }), 0).state, 'focused');
}
console.log('All classifier tests passed.');
