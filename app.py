"""
Image Describer — Batch image folder → Markdown descriptions
Uses a local vision LLM (Ollama / LM Studio) via OpenAI-compatible API.
"""

import base64
import json
import os
import sys
import threading
import time
from io import BytesIO
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, render_template, request
from PIL import Image

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_API_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "qwen3-vl-8b"
DEFAULT_PROMPT = (
    "Describe this image in detail. Include the subject, composition, "
    "colors, mood, lighting, style, and any notable elements."
)


# Length presets — appended to the base prompt
LENGTH_PROMPTS = {
    "short":  "Keep it very brief — 1 to 2 sentences maximum.",
    "medium": "Be thorough but concise — aim for 3 to 5 sentences.",
    "long":   "Be very detailed and thorough — write 6 to 10 sentences covering every aspect.",
}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def encode_image(path: str) -> str:
    """Load, resize to a safe max dimension, and base64-encode an image."""
    img = Image.open(path)
    # Convert palette / RGBA images to RGB for JPEG encoding
    if img.mode in ("P", "RGBA", "LA"):
        img = img.convert("RGB")

    # Hardcoded max dimension to prevent LM Studio from crashing (400 Bad Request)
    # due to local VRAM / context limits being exceeded by raw high-res images.
    # 1024px is required for stability on consecutive requests with large prompts.
    max_dim = 1024
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def get_image_files(folder: str) -> list[str]:
    """Return sorted list of image file paths in *folder*."""
    folder_path = Path(folder)
    if not folder_path.is_dir():
        return []
    files = [
        str(f)
        for f in sorted(folder_path.iterdir())
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return files


def describe_image(
    api_url: str,
    model: str,
    prompt: str,
    image_b64: str,
    filename: str,
) -> str:
    """Call the vision model and return its text description."""
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"[Image: {filename}]\n{prompt}"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                ],
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.4,
        "stream": False,
    }
    resp = requests.post(
        f"{api_url.rstrip('/')}/chat/completions",
        json=payload,
        timeout=300,
    )
    if not resp.ok:
        # Capture the actual error body from the API for diagnostics
        try:
            err_body = resp.json()
            err_msg = err_body.get("error", {}).get("message", resp.text[:300])
        except Exception:
            err_msg = resp.text[:300]
        raise RuntimeError(f"{resp.status_code} — {err_msg}")
    data = resp.json()
    # Handle responses that may include thinking content
    content = data["choices"][0]["message"]["content"]
    if content is None:
        content = ""
    return content.strip()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health", methods=["POST"])
def health():
    """Check connectivity to the LLM API and whether the model is available."""
    body = request.get_json(silent=True) or {}
    api_url = body.get("api_url", DEFAULT_API_URL)
    model = body.get("model", DEFAULT_MODEL)

    try:
        # Try the /v1/models endpoint first (OpenAI-compatible)
        r = requests.get(f"{api_url.rstrip('/')}/models", timeout=10)
        if r.ok:
            models_data = r.json()
            model_ids = [m.get("id", "") for m in models_data.get("data", [])]
            found = any(model in mid for mid in model_ids)
            return jsonify({"ok": True, "model_found": found, "models": model_ids})

        # Fallback: just check if the endpoint responds
        return jsonify({"ok": True, "model_found": False, "models": []})
    except requests.exceptions.ConnectionError:
        return jsonify({"ok": False, "error": "Cannot connect to API"}), 502
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/browse", methods=["POST"])
def browse():
    """Open a native folder picker and return the chosen path + image count."""
    # Run tkinter in a separate thread to avoid event loop issues
    result = {"path": None}

    def pick():
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            chosen = filedialog.askdirectory(title="Select Image Folder")
            root.destroy()
            result["path"] = chosen if chosen else None
        except Exception:
            result["path"] = None

    t = threading.Thread(target=pick)
    t.start()
    t.join(timeout=120)

    path = result["path"]
    if not path:
        return jsonify({"path": None, "count": 0})

    images = get_image_files(path)
    return jsonify({"path": path, "count": len(images)})


@app.route("/api/process")
def process():
    """SSE endpoint — streams processing progress to the client."""
    folder = request.args.get("folder", "")
    api_url = request.args.get("api_url", DEFAULT_API_URL)
    model = request.args.get("model", DEFAULT_MODEL)
    base_prompt = request.args.get("prompt", DEFAULT_PROMPT)
    length = request.args.get("length", "medium")
    custom_instructions = request.args.get("custom_instructions", "")

    output_name = request.args.get("output", "image_descriptions.md")

    # Build the full prompt from parts
    length_hint = LENGTH_PROMPTS.get(length, LENGTH_PROMPTS["medium"])
    prompt = f"{base_prompt} {length_hint}"
    if custom_instructions.strip():
        prompt += f"\n\nAdditional instructions: {custom_instructions.strip()}"

    def generate():
        images = get_image_files(folder)
        total = len(images)

        if total == 0:
            yield _sse({"type": "error", "message": "No images found in folder."})
            return

        yield _sse({
            "type": "start",
            "total": total,
            "folder": folder,
        })

        descriptions: list[dict] = []

        for i, img_path in enumerate(images, 1):
            fname = os.path.basename(img_path)
            yield _sse({
                "type": "progress",
                "current": i,
                "total": total,
                "filename": fname,
                "status": "processing",
            })

            try:
                b64 = encode_image(img_path)
                desc = describe_image(api_url, model, prompt, b64, fname)
                descriptions.append({"filename": fname, "description": desc})

                yield _sse({
                    "type": "result",
                    "current": i,
                    "total": total,
                    "filename": fname,
                    "description": desc,
                })
            except Exception as e:
                error_msg = str(e)
                descriptions.append({"filename": fname, "description": f"[ERROR] {error_msg}"})
                yield _sse({
                    "type": "result",
                    "current": i,
                    "total": total,
                    "filename": fname,
                    "description": f"[ERROR] {error_msg}",
                })

        # Write markdown file
        md_path = os.path.join(folder, output_name)
        md_content = _build_markdown(descriptions, folder)

        try:
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(md_content)
            yield _sse({
                "type": "done",
                "output_path": md_path,
                "markdown": md_content,
                "total_processed": total,
            })
        except Exception as e:
            yield _sse({"type": "error", "message": f"Failed to write file: {e}"})

    return Response(generate(), mimetype="text/event-stream")


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _build_markdown(descriptions: list[dict], folder: str) -> str:
    lines = [
        f"# Image Descriptions",
        f"",
        f"> Generated from: `{folder}`  ",
        f"> Date: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"",
        f"---",
        f"",
    ]
    for entry in descriptions:
        lines.append(f"## {entry['filename']}")
        lines.append(f"")
        lines.append(f"![{entry['filename']}](./{entry['filename']})")
        lines.append(f"")
        lines.append(entry["description"])
        lines.append(f"")
        lines.append(f"---")
        lines.append(f"")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import webbrowser

    port = 5000
    # Open browser after a short delay
    threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{port}")).start()
    print(f"\n  Image Describer running at http://localhost:{port}\n")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
