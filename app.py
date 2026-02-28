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
import queue
import re
import concurrent.futures
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
PRESET_PROMPTS = {
    "Tags": "Your task is to generate a clean list of comma-separated tags for a text-to-image AI, based *only* on the visual information in the image. Limit the output to a maximum of 50 unique tags. Strictly describe visual elements like subject, clothing, environment, colors, lighting, and composition. Do not include abstract concepts, interpretations, marketing terms, or technical jargon. Avoid repeating tags.",
    "Simple Description": "Analyze the image and write a single concise sentence that describes the main subject and setting. Keep it grounded in visible details only.",
    "Detailed Description": "Write ONE detailed paragraph (6–10 sentences). Describe only what is visible: subject(s) and actions; people details if present (approx age group, gender expression if clear, hair, facial expression, pose, clothing, accessories); environment (location type, background elements, time cues); lighting (source, direction, softness/hardness, color temperature, shadows); camera viewpoint (eye-level/low/high, distance) and composition (framing, focal emphasis). No preface, no reasoning, no <think>.",
    "Ultra Detailed Description": "Write ONE ultra-detailed paragraph (10–16 sentences, ~180–320 words). Stay grounded in visible details. Include: subject micro-details (materials, textures, patterns, wear, reflections); people details if present (hair, skin tones, makeup, jewelry, fabric types, fit); environment depth (foreground/midground/background, signage/props, surface materials); lighting analysis (key/fill/back light, direction, softness, highlights, shadow shape); camera perspective (angle, lens feel, depth of field) and composition (leading lines, negative space, symmetry/asymmetry, visual hierarchy). No preface, no reasoning, no <think>.",
    "Cinematic Description": "Write ONE cinematic paragraph (8–12 sentences). Describe the scene like a film still: subject(s) and action; environment and atmosphere; lighting design (practical lights vs ambient, direction, contrast); camera language (shot type, angle, lens feel, depth of field, motion implied); composition and mood. Keep it vivid but factual (no made-up story). No preface, no reasoning, no <think>.",
    "Detailed Analysis": "Output ONLY these sections with short labels (no bullets): Subject; People (if any); Environment; Lighting; Camera/Composition; Color/Texture. In each section, write 2–4 sentences of concrete visible details. If something is not visible, write 'not visible'. No preface, no reasoning, no <think>.",
    "None": ""
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
    # 768px provides excellent detail for Qwen-VL without exhausting resources.
    max_dim = 768
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
        "max_tokens": 2048,
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
    model = body.get("model", DEFAULT_MODEL)

    try:
        # Try the /v1/models endpoint first (OpenAI-compatible)
        r = requests.get(f"{DEFAULT_API_URL.rstrip('/')}/models", timeout=10)
        if r.ok:
            models_data = r.json()
            model_ids = [m.get("id", "") for m in models_data.get("data", [])]
            found = any(model in mid for mid in model_ids)
            msg = ""
            if not found:
                msg = f"Model '{model}' is not downloaded in this provider. If using Ollama, run 'ollama pull {model}' in your terminal."
            return jsonify({"ok": True, "model_found": found, "models": model_ids, "error": msg})

        # Fallback: just check if the endpoint responds
        return jsonify({"ok": True, "model_found": False, "models": [], "error": "Endpoint responsive, but could not list models."})
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
    # Extract just the filenames
    files = [os.path.basename(img) for img in images]
    return jsonify({"path": path, "count": len(images), "files": files})


@app.route("/api/process", methods=["POST"])
def process():
    """SSE endpoint — streams processing progress to the client via POST body params."""
    body = request.get_json(silent=True) or {}
    folder = body.get("folder", "")
    model = body.get("model", DEFAULT_MODEL)
    base_prompt = body.get("prompt", DEFAULT_PROMPT)
    preset_key = body.get("preset", "Detailed Description")
    custom_instructions = body.get("custom_instructions", "")

    output_name = body.get("output", "image_descriptions.md")
    skip_existing = bool(body.get("skip_existing"))
    
    try:
        concurrency = int(body.get("concurrency", 1))
    except (ValueError, TypeError):
        concurrency = 1

    # If the user selects a sophisticated template (e.g. 'Tags', 'Cinematic Description')
    # it completely overrides the base prompt. If they select 'None', we use their base prompt.
    preset_instruction = PRESET_PROMPTS.get(preset_key, "")
    
    if preset_key == "None" or not preset_instruction:
        prompt = base_prompt.strip()
    else:
        prompt = preset_instruction.strip()
        
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
        
        md_path = os.path.join(folder, output_name)
        desc_map = {}
        if skip_existing:
            desc_map = parse_existing_markdown(md_path)

        q = queue.Queue()

        def worker(img_path):
            fname = os.path.basename(img_path)
            
            if skip_existing and fname in desc_map:
                q.put({"type": "result", "filename": fname, "description": desc_map[fname], "skipped": True})
                return

            q.put({"type": "progress", "filename": fname, "status": "processing"})
            
            error_msg = None
            success = False
            for attempt in range(3):
                try:
                    b64 = encode_image(img_path)
                    desc = describe_image(DEFAULT_API_URL, model, prompt, b64, fname)
                    q.put({"type": "result", "filename": fname, "description": desc, "skipped": False})
                    success = True
                    break
                except Exception as e:
                    error_msg = str(e)
                    if attempt < 2:
                        time.sleep(2 ** (attempt + 1)) # Wait 2s, then 4s...
            
            if not success:
                q.put({"type": "result", "filename": fname, "description": f"[ERROR] {error_msg}", "skipped": False})
                
            # GC breathing room for local LLMs
            if concurrency == 1:
                time.sleep(1.5)

        def pool_runner():
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
                list(executor.map(worker, images))
            q.put(None) # Sentinel to end generation

        threading.Thread(target=pool_runner, daemon=True).start()

        processed_count = 0
        while True:
            evt = q.get()
            if evt is None:
                break
                
            if evt.get("type") == "result":
                processed_count += 1
                evt["current"] = processed_count
                evt["total"] = total
                
                # Progressive save logic ensuring no data is lost on crash
                desc_map[evt["filename"]] = evt["description"]
                md_content = _build_markdown_from_map(desc_map, folder)
                try:
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write(md_content)
                except Exception:
                    pass
                
            yield _sse(evt)

        # Final yield to ensure client finishes
        try:
            md_content = _build_markdown_from_map(desc_map, folder)
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


def parse_existing_markdown(filepath: str) -> dict:
    if not os.path.exists(filepath):
        return {}
    
    content = Path(filepath).read_text(encoding="utf-8")
    pattern = re.compile(r"^## (.*?)\n(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
    matches = pattern.findall(content)
    
    result = {}
    for fname, block in matches:
        fname = fname.strip()
        lines = block.strip().split("\n")
        # Remove leading image links
        while lines and (lines[0].strip() == "" or lines[0].startswith("![")):
            lines.pop(0)
        # Remove trailing artifact dividers
        while lines and (lines[-1].strip() == "" or lines[-1].strip() == "---"):
            lines.pop()
        
        desc = "\n".join(lines).strip()
        result[fname] = desc
    return result


def _build_markdown_from_map(desc_map: dict, folder: str) -> str:
    lines = [
        f"# Image Descriptions",
        f"",
        f"> Generated from: `{folder}`  ",
        f"> Date: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"",
        f"---",
        f"",
    ]
    # Sort files alphabetically for consistent output
    for fname in sorted(desc_map.keys()):
        lines.append(f"## {fname}")
        lines.append(f"")
        lines.append(f"![{fname}](./{fname})")
        lines.append(f"")
        lines.append(desc_map[fname])
        lines.append(f"")
        lines.append(f"---")
        lines.append(f"")
    return "\n".join(lines)


@app.route("/api/image")
def get_image():
    """Serve an image from the local filesystem."""
    from flask import send_from_directory
    folder = request.args.get("folder", "")
    filename = request.args.get("filename", "")
    if not folder or not filename:
        return "Missing folder or filename", 400
    
    file_path = os.path.join(folder, filename)
    if not os.path.exists(file_path):
        return "File not found", 404
        
    return send_from_directory(folder, filename)


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
