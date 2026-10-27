"""Tiny local server for AttentionAI.  Run:  python server.py   ->  http://localhost:5000

The app itself is 100% static (it runs in the browser), so this is only for local use.
localhost counts as a secure origin, which the webcam API requires.
"""
import mimetypes
import os

from flask import Flask, abort, jsonify, send_from_directory

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("application/wasm", ".wasm")

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIRS = {"css", "js", "assets", "vendor", "models"}
app = Flask(__name__, static_folder=None)


@app.after_request
def secure(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/healthz")
def health():
    return jsonify(status="ok", app="AttentionAI", version="2.0.0")


@app.get("/<path:path>")
def files(path):
    if path.split("/")[0] not in PUBLIC_DIRS:
        abort(404)
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"AttentionAI running at http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
