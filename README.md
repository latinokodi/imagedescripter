# Image Describer

Batch-convert an image folder into a Markdown file with detailed AI-generated descriptions using a local vision LLM.

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.0+-green?logo=flask)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Batch processing** — point at any folder and describe every image in it
- **Description length control** — Short (1–2 sentences), Medium (3–5), or Long (6–10)
- **Custom instructions** — append extra context to every prompt (e.g., "focus on architecture", "mention text in images")
- **Real-time progress** — SSE-powered live log with per-image status
- **Markdown output** — generates a `.md` file with embedded image links and descriptions
- **Dark glassmorphism GUI** — modern web interface, no Electron overhead
- **Works with Ollama or LM Studio** — any OpenAI-compatible vision API
- **Native folder picker** — uses OS file dialog via tkinter
- **One-click launcher** — `run.bat` handles venv, deps, and browser

## Quick Start

### Prerequisites

- **Python 3.10+** installed and on PATH
- **Ollama** or **LM Studio** running with a vision model

### Using Ollama (Recommended)

```bash
# 1. Install Ollama from https://ollama.com
# 2. Pull the vision model
ollama pull qwen3-vl-8b

# 3. Ollama serves automatically on localhost:11434
# 4. Double-click run.bat or:
python app.py
```

### Using LM Studio

1. Open **LM Studio** and download **Qwen3-VL-8B** from the model browser
2. Go to the **Developer** tab (or **Local Server** in older versions)
3. Load the **Qwen3-VL-8B** model
4. Click **Start Server** — it will run on `http://localhost:1234`
5. In the Image Describer GUI, change **API Endpoint** to:
   ```
   http://localhost:1234/v1
   ```
6. Click **Test Connection** to verify

> **Tip:** In LM Studio's server settings, make sure "Enable CORS" is turned on if you have issues.

### Launch

```bash
# Option A: Double-click
run.bat

# Option B: Manual
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Opens `http://localhost:5000` in your browser automatically.

## Usage

1. **Configure** — set API endpoint, model name, description length, and any custom instructions
2. **Browse** — click "Browse Folder" and select a folder with images
3. **Process** — click "Start Processing" and watch the live log
4. **Result** — the generated `image_descriptions.md` is saved in the image folder

## Supported Image Formats

`.jpg` `.jpeg` `.png` `.gif` `.bmp` `.webp` `.tiff`

## Project Structure

```
imagedescripter/
├── app.py              # Flask backend
├── requirements.txt    # Python dependencies
├── run.bat             # Windows launcher
├── static/
│   ├── style.css       # Dark theme styles
│   └── app.js          # Frontend logic
└── templates/
    └── index.html      # GUI template
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python + Flask |
| Frontend | Vanilla HTML/CSS/JS |
| Vision API | Ollama / LM Studio (OpenAI-compatible) |
| Image Processing | Pillow |
| Progress Streaming | Server-Sent Events (SSE) |

## License

MIT
