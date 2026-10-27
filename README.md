# AttentionAI v2

Real-time attention and drowsiness tracking that runs **entirely in your browser**. Your webcam feed never leaves your device.

Webcam → Analyze → Understand → Alert → Measure

## What's new in v2
- Brand-new interactive interface: animated eyes that mirror your gaze, state-coloured aura, live head-pose pad, dark and light themes.
- Runs fully client-side (MediaPipe Face Landmarker in the browser), so it can be deployed as a static site and used by anyone through a secure link.
- Better signals: blink and gaze from 52 facial blendshapes, true 3D head pose, PERCLOS (share of time eyes are closed), microsleep and yawn detection.
- 3-second calibration so it learns how *you* sit and where your camera is.
- Four states: Focused, Distracted, Drowsy, Away.
- Alarms synthesised in the browser (gentle chime for distraction, urgent beeps for drowsiness, louder over time), plus a banner and vibration on phones.
- Attention score, focus streaks, longest distraction, live timeline, donut breakdown.
- Settings: sensitivity presets, delays, volume, theme. Session history and CSV export.
- Shortcuts: `Space` pause, `M` mute, `C` recalibrate.
- Add `?demo` to the URL to preview the whole UI with simulated data and no camera.

## Run locally
```bash
pip install -r requirements.txt
python server.py          # http://localhost:5000
npm test                  # optional: classifier tests (Node 18+)
```
Any static server works too (`npx serve .`). The camera needs `https://` or `localhost`.

## Deploy so everyone can open it (free, HTTPS included)
1. Create a GitHub repo and push:
   ```bash
   git init && git add . && git commit -m "AttentionAI v2"
   git branch -M main && git remote add origin https://github.com/<you>/attentionai.git && git push -u origin main
   ```
2. Go to vercel.com → **Add New → Project** → import the repo → **Deploy**. No build settings needed (static site). `vercel.json` already sets security headers and allows the camera.
3. Share the `https://<name>.vercel.app` link. GitHub Pages and Netlify work the same way.

## Project layout
```
index.html          page structure
css/styles.css      design system and layout
js/main.js          app controller (UI, session, alarms, settings, history)
js/detector.js      camera + MediaPipe + feature extraction (EAR, gaze, head pose)
js/classifier.js    pure state machine: Focused / Distracted / Drowsy / Away
js/audio.js         Web Audio alarm sounds
js/charts.js        canvas donut, timeline, bar charts
js/overlay.js       face HUD drawn over the video
js/storage.js       history + CSV export
server.py           optional local Flask server
tests/              classifier unit tests
scripts/vendor.sh   optional: download MediaPipe + model for fully offline use
```

## How it decides
- **Distracted**: head or eyes beyond the sensitivity limit (relative to your calibration) for longer than the *Distracted after* delay.
- **Drowsy**: eyes closed 1.2s straight, or closed for over 30% of the last 30s, or repeated yawns with tired eyes.
- **Away**: no face for 3s.
- Tune everything in `js/config.js` or the Settings panel.

## Notes
- First load downloads the vision library (jsDelivr) and a ~4 MB face model (Google storage). Run `scripts/vendor.sh` to bundle them instead.
- If the head-pose pad moves the wrong way on your device, flip a sign in `HEAD_SIGN` in `js/config.js`.
- Browsers slow down hidden tabs, so keep the tab visible while tracking.

Made with love by Rohith.
