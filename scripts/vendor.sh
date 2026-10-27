#!/usr/bin/env bash
# Optional: download the MediaPipe library + face model so the app works fully offline
# and does not depend on a CDN. Run once from the project root, then commit the files
# (remove the two vendor lines from .gitignore first).
set -euo pipefail
VER=0.10.14
mkdir -p vendor models
npm pack "@mediapipe/tasks-vision@$VER" --silent
tar -xzf "mediapipe-tasks-vision-$VER.tgz"
rm -rf vendor/tasks-vision && mv package vendor/tasks-vision && rm "mediapipe-tasks-vision-$VER.tgz"
curl -L --fail -o models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
echo "Done. vendor/tasks-vision and models/face_landmarker.task are ready."
