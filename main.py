import os
import json
import base64
import asyncio
import aiohttp
import traceback
import tkinter as tk
from tkinter import filedialog
from pathlib import Path
from typing import List
from pydantic import BaseModel
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ─── API sub-application ──────────────────────────────────────────────────────
# Mounted at /api so StaticFiles at / never intercepts API calls
api = FastAPI()

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EVENT_QUEUE: asyncio.Queue = asyncio.Queue()
JOB_QUEUE: asyncio.Queue = asyncio.Queue()
PROCESSING_STATE = {"is_running": False, "cancel_requested": False}

def select_folder() -> str:
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    folder = filedialog.askdirectory()
    root.destroy()
    return folder

class Config(BaseModel):
    modelName: str = ""
    systemPrompt: str = ""
    userPrompt: str = ""
    selectedPreset: str = ""

class StartRequest(BaseModel):
    config: Config
    files: List[str]
    folder: str

CONFIG_FILE = "config.json"
QWENVL_PROMPTS_PATH = Path(r"F:\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI-QwenVL\AILab_System_Prompts.json")

@api.get("/system_prompts")
async def get_system_prompts():
    try:
        with open(QWENVL_PROMPTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        ordered = data.get("_preset_prompts", [])
        texts = data.get("qwenvl", {})
        prompts = {name: texts.get(name, "") for name in ordered if name in texts}
        return {"prompts": prompts}
    except FileNotFoundError:
        return {"prompts": {}}
    except Exception as e:
        return {"prompts": {}, "error": str(e)}

@api.get("/dialog/folder")
async def get_folder():
    folder = await asyncio.to_thread(select_folder)
    return JSONResponse({"folder": folder})

@api.get("/images")
async def list_images(path: str):
    if not os.path.isdir(path):
        return {"files": []}
    valid_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    files = [
        f for f in os.listdir(path)
        if os.path.isfile(os.path.join(path, f))
        and os.path.splitext(f)[1].lower() in valid_exts
    ]
    return {"files": sorted(files)}

@api.get("/image")
async def get_image(folder: str, filename: str):
    filepath = os.path.join(folder, filename)
    if not os.path.exists(filepath):
        return JSONResponse({"error": "File not found"}, status_code=404)
    return FileResponse(filepath)

@api.post("/save_config")
async def save_config(config: Config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config.dict(), f, indent=2)
    return {"status": "success"}

@api.get("/load_config")
async def load_config():
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        return {"error": str(e)}

async def _sse_publisher(request: Request):
    while True:
        if await request.is_disconnected():
            break
        event_data = await EVENT_QUEUE.get()
        yield f"data: {json.dumps(event_data)}\n\n"

@api.get("/stream")
async def stream_events(request: Request):
    return StreamingResponse(_sse_publisher(request), media_type="text/event-stream")

MIME_MAP = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".bmp":  "image/bmp",
    ".gif":  "image/gif",
}

def encode_image(filepath: str) -> tuple[str, str]:
    """Returns (base64_data, mime_type)."""
    ext = os.path.splitext(filepath)[1].lower()
    mime = MIME_MAP.get(ext, "image/jpeg")
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8"), mime

async def _call_api(session, payload, filename):
    """POST to LM Studio and stream response back. Returns (full_description, error_str)."""
    url = "http://127.0.0.1:1234/v1/chat/completions"
    print(f"[API] --> POST {url}  file={filename} (streaming={payload.get('stream')})")
    
    try:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=600)) as resp:
            if resp.status != 200:
                body = await resp.text()
                return None, f"API {resp.status}: {body}"
                
            if payload.get("stream"):
                full_text = ""
                async for line in resp.content:
                    line = line.decode('utf-8').strip()
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            data = json.loads(line[6:])
                            token = data["choices"][0]["delta"].get("content", "")
                            if token:
                                full_text += token
                                await EVENT_QUEUE.put({"type": "token", "file": filename, "description": full_text})
                        except json.JSONDecodeError:
                            pass
                return full_text, None
            else:
                body = await resp.text()
                data = json.loads(body)
                return data["choices"][0]["message"]["content"], None
    except Exception as e:
        return None, str(e)

def _append_to_descriptions(folder: str, filename: str, desc: str | None):
    """Append a single description result to descriptions.md in the target folder."""
    from datetime import datetime
    out_path = os.path.join(folder, "descriptions.md")
    
    # Write header if file doesn't exist
    if not os.path.exists(out_path):
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(f"# Image Descriptions\n\nStarted: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n---\n\n")
            
    lines = [f"## {filename}\n"]
    if desc:
        lines.append(desc.strip())
    else:
        lines.append("_Generation failed for this image._")
    lines.append("\n\n---\n\n")
    
    with open(out_path, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))

async def process_image(filepath, filename, config):
    print(f"\n[PROC] Starting: {filename}")
    await EVENT_QUEUE.put({"type": "status", "file": filename, "status": "processing"})
    try:
        base64_img, mime = await asyncio.to_thread(encode_image, filepath)
        print(f"[PROC] Encoded {filename}: mime={mime}  size={len(base64_img)} chars")

        payload = {
            "messages": [
                {"role": "system", "content": config.systemPrompt},
                {"role": "user", "content": [
                    {"type": "text", "text": config.userPrompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64_img}"}}
                ]}
            ],
            "temperature": 0.3,
            "max_tokens": 1000,
            "stream": True # Enabled Streaming
        }
        if config.modelName:
            payload["model"] = config.modelName
            print(f"[PROC] Using model: {config.modelName}")

        async with aiohttp.ClientSession() as session:
            desc, err = await _call_api(session, payload, filename)

            # One automatic retry on failure
            if err:
                print(f"[PROC] Attempt 1 failed for {filename}: {err}  — retrying in 2s")
                await asyncio.sleep(2)
                desc, err = await _call_api(session, payload, filename)

        if err:
            print(f"[PROC] FINAL ERROR for {filename}: {err}")
            await EVENT_QUEUE.put({"type": "status", "file": filename, "status": "error", "error": err})
            return filename, None
        else:
            print(f"[PROC] Done: {filename}  ({len(desc)} chars)")
            await EVENT_QUEUE.put({"type": "done", "file": filename, "description": desc})
            return filename, desc

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[PROC] EXCEPTION for {filename}:\n{tb}")
        await EVENT_QUEUE.put({"type": "status", "file": filename, "status": "error", "error": str(e)})
        return filename, None

async def _background_worker():
    """Forever loop pulling jobs from JOB_QUEUE and processing sequentially."""
    print("[WORKER] Started background queue worker.")
    while True:
        job = await JOB_QUEUE.get()
        folder, filename, config = job
        PROCESSING_STATE["is_running"] = True
        
        # Check if cancellation was requested before processing
        if PROCESSING_STATE["cancel_requested"]:
            print(f"[WORKER] Skipping {filename} due to stop request.")
            await EVENT_QUEUE.put({"type": "status", "file": filename, "status": "stopped", "error": "Cancelled"})
            JOB_QUEUE.task_done()
            
            if JOB_QUEUE.empty():
                PROCESSING_STATE["cancel_requested"] = False
                PROCESSING_STATE["is_running"] = False
                await EVENT_QUEUE.put({"type": "status", "file": "__all__", "status": "stopped"})
            continue

        try:
            fname, desc = await process_image(os.path.join(folder, filename), filename, config)
            # Append result
            await asyncio.to_thread(_append_to_descriptions, folder, fname, desc)
        except Exception as e:
            print(f"[WORKER] Unhandled exception processing {filename}: {e}")
        finally:
            JOB_QUEUE.task_done()
            
            # If queue is now empty, emit complete/stop
            if JOB_QUEUE.empty():
                PROCESSING_STATE["is_running"] = False
                status = "stopped" if PROCESSING_STATE["cancel_requested"] else "complete"
                PROCESSING_STATE["cancel_requested"] = False
                await EVENT_QUEUE.put({"type": "status", "file": "__all__", "status": status})

@api.post("/start")
async def start_processing(req: StartRequest):
    PROCESSING_STATE["cancel_requested"] = False # Reset cancel flag
    for filename in req.files:
        await JOB_QUEUE.put((req.folder, filename, req.config))
    return {"status": "enqueued", "count": len(req.files)}

@api.post("/stop")
async def stop_processing():
    if not JOB_QUEUE.empty() or PROCESSING_STATE["is_running"]:
        PROCESSING_STATE["cancel_requested"] = True
        
        # Flush the queue instantly
        while not JOB_QUEUE.empty():
            try:
                folder, filename, config = JOB_QUEUE.get_nowait()
                await EVENT_QUEUE.put({"type": "status", "file": filename, "status": "stopped", "error": "Cancelled"})
                JOB_QUEUE.task_done()
            except asyncio.QueueEmpty:
                break
                
        print("[STOP] User requested stop. Queue flushed. Current active item will finish.")
        return {"status": "stopping"}
    return {"status": "not_running"}

# ─── Root application ─────────────────────────────────────────────────────────

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(_background_worker())

app.mount("/api", api)                                               # API first
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="spa")  # SPA last
