// Camera + MediaPipe Face Landmarker wrapper. Everything runs in the browser:
// no video ever leaves the device.
const VER = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const LOCAL_LIB = new URL('../vendor/tasks-vision', import.meta.url).href;
const LOCAL_MODEL = new URL('../models/face_landmarker.task', import.meta.url).href;
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const EYE_A = [33, 160, 158, 133, 153, 144];
const EYE_B = [362, 385, 387, 263, 373, 380];
const R2D = 180 / Math.PI;

// Keep angles in [-90, 90] so a flipped axis convention can never produce "180 degree" roll.
const wrap = (a) => {
  a = ((a + 180) % 360 + 360) % 360 - 180;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
};

/** Eye aspect ratio from six landmarks, measured in pixels so the aspect ratio is correct. */
export function eyeAspect(lm, idx, w, h) {
  const p = (i) => lm[idx[i]];
  const d = (a, b) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  return (d(p(1), p(5)) + d(p(2), p(4))) / (2 * d(p(0), p(3)) || 1);
}

/** Head pose in degrees from MediaPipe's 4x4 column-major face transform. */
export function headPose(m) {
  const c0 = Math.hypot(m[0], m[1], m[2]) || 1;
  const c1 = Math.hypot(m[4], m[5], m[6]) || 1;
  const c2 = Math.hypot(m[8], m[9], m[10]) || 1;
  const r00 = m[0] / c0, r10 = m[1] / c0, r20 = m[2] / c0, r21 = m[6] / c1, r22 = m[10] / c2;
  return {
    pitch: wrap(Math.atan2(r21, r22) * R2D),
    yaw: wrap(Math.atan2(-r20, Math.hypot(r00, r10)) * R2D),
    roll: wrap(Math.atan2(r10, r00) * R2D),
  };
}

// Rough landmark-only fallback if the transform matrix is unavailable.
function fallbackPose(lm) {
  const l = lm[234], r = lm[454], n = lm[1], top = lm[10], bot = lm[152];
  const half = Math.abs(r.x - l.x) / 2 || 1, vh = Math.abs(bot.y - top.y) / 2 || 1;
  return {
    yaw: ((n.x - (l.x + r.x) / 2) / half) * 60,
    pitch: ((n.y - (top.y + bot.y) / 2) / vh) * 60,
    roll: Math.atan2(r.y - l.y, r.x - l.x) * R2D,
  };
}

/** Turn one MediaPipe result into the compact feature frame the classifier uses. */
export function extract(res, w, h) {
  const lm = res.faceLandmarks?.[0];
  if (!lm) return { face: false };
  const bs = {};
  for (const c of res.faceBlendshapes?.[0]?.categories ?? []) bs[c.categoryName] = c.score;
  const g = (n) => bs[n] || 0;
  const hasBS = bs.eyeBlinkLeft != null;
  const mtx = res.facialTransformationMatrixes?.[0]?.data;
  const pose = mtx ? headPose(mtx) : fallbackPose(lm);
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return {
    face: true, lm, box: { x0, y0, x1, y1 },
    ear: (eyeAspect(lm, EYE_A, w, h) + eyeAspect(lm, EYE_B, w, h)) / 2,
    blinkScore: hasBS ? (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2 : null,
    // Gaze: x > 0 means the user looks to their right, y > 0 means up.
    gx: (g('eyeLookOutRight') + g('eyeLookInLeft') - g('eyeLookOutLeft') - g('eyeLookInRight')) / 2,
    gy: (g('eyeLookUpLeft') + g('eyeLookUpRight') - g('eyeLookDownLeft') - g('eyeLookDownRight')) / 2,
    jaw: g('jawOpen'),
    ...pose,
  };
}

export class Detector {
  constructor() { this.fl = null; this.video = null; this.stream = null; this.lastTime = -1; this.shapes = null; }

  async init(onStatus = () => {}) {
    onStatus('Loading vision engine…');
    let mod, wasm;
    try { mod = await import(`${LOCAL_LIB}/vision_bundle.mjs`); wasm = `${LOCAL_LIB}/wasm`; }
    catch { mod = await import(`${CDN}/vision_bundle.mjs`); wasm = `${CDN}/wasm`; }
    const { FaceLandmarker, FilesetResolver } = mod;
    const fileset = await FilesetResolver.forVisionTasks(wasm);

    onStatus('Loading face model…');
    let model = REMOTE_MODEL;
    try {
      const r = await fetch(LOCAL_MODEL, { method: 'HEAD' });
      if (r.ok && !/html/.test(r.headers.get('content-type') || '')) model = LOCAL_MODEL;
    } catch { /* use remote model */ }

    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try { this.fl = await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { this.fl = await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }

    this.shapes = {
      oval: FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, eyeL: FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      eyeR: FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, lips: FaceLandmarker.FACE_LANDMARKS_LIPS,
    };
  }

  async startCamera(video) {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.lastTime = -1;
  }

  /** Returns a feature frame, or null if the camera has no new frame yet. */
  detect() {
    const v = this.video;
    if (!this.fl || !v || v.readyState < 2 || v.currentTime === this.lastTime) return null;
    this.lastTime = v.currentTime;
    return extract(this.fl.detectForVideo(v, performance.now()), v.videoWidth, v.videoHeight);
  }
}
