/**
 * Image Describer — Frontend Logic
 * Handles folder selection, SSE processing stream, and UI state.
 */

// ─── DOM Refs ────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const els = {
    modelName: $('#modelName'),
    basePromptGroup: $('#basePromptGroup'),
    promptText: $('#promptText'),
    promptPreset: $('#promptPreset'),
    outputName: $('#outputName'),
    customInstructions: $('#customInstructions'),
    skipExisting: $('#skipExisting'),
    concurrency: $('#concurrency'),
    concurrencyVal: $('#concurrencyVal'),
    modelList: $('#modelList'),
    btnCheckHealth: $('#btnCheckHealth'),
    btnBrowse: $('#btnBrowse'),
    btnStart: $('#btnStart'),
    folderPath: $('#folderPath'),
    folderCount: $('#folderCount'),
    connectionStatus: $('#connectionStatus'),
    statusDot: $('#connectionStatus .status-dot'),
    statusText: $('#connectionStatus .status-text'),
    progressSection: $('#progressSection'),
    progressLabel: $('#progressLabel'),
    progressCounter: $('#progressCounter'),
    progressBar: $('#progressBar'),
    galleryContainer: $('#galleryContainer'),
};

// ─── State ───────────────────────────────────────────────────────────
let state = {
    folder: null,
    imageCount: 0,
    processing: false,
};

// ─── Health Check ────────────────────────────────────────────────────
async function checkHealth() {
    setConnectionStatus('checking');
    try {
        const resp = await fetch('/api/health', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: els.modelName.value,
            })
        });
        const data = await resp.json();

        if (data.models && data.models.length > 0) {
            els.modelList.innerHTML = '';
            data.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                els.modelList.appendChild(opt);
            });
        }

        if (data.ok && data.model_found) {
            setConnectionStatus('connected', `Connected — model found`);
        } else if (data.ok) {
            setConnectionStatus('warning', data.error ? data.error : `API reachable — model not found`);
        } else {
            setConnectionStatus('disconnected', data.error || 'Connection failed');
        }
    } catch (err) {
        setConnectionStatus('disconnected', 'Cannot reach server');
    }
}

function setConnectionStatus(status, text) {
    const dot = els.statusDot;
    const txt = els.statusText;
    dot.className = 'status-dot';

    if (status === 'connected') {
        dot.classList.add('connected');
        txt.textContent = text || 'Connected';
    } else if (status === 'disconnected') {
        dot.classList.add('disconnected');
        txt.textContent = text || 'Disconnected';
    } else if (status === 'warning') {
        dot.classList.add('warning');
        txt.textContent = text || 'Warning';
    } else {
        txt.textContent = text || 'Checking...';
    }
}

// ─── Folder Browse ───────────────────────────────────────────────────
async function browseFolder() {
    els.btnBrowse.disabled = true;
    els.btnBrowse.textContent = 'Opening...';

    try {
        const resp = await fetch('/api/browse', { method: 'POST' });
        const data = await resp.json();

        if (data.path) {
            state.folder = data.path;
            state.imageCount = data.count;
            els.folderPath.textContent = data.path;
            els.folderPath.classList.add('active');
            els.folderCount.textContent = `${data.count} image${data.count !== 1 ? 's' : ''} found`;
            els.btnStart.disabled = data.count === 0;

            // Build gallery items
            if (els.galleryContainer) {
                els.galleryContainer.innerHTML = '';
                if (data.files && data.files.length > 0) {
                    data.files.forEach(file => {
                        const safeId = file.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const card = document.createElement('div');
                        card.className = 'image-card';
                        card.id = `card-${safeId}`;
                        card.innerHTML = `
                            <div class="card-image-wrapper">
                                <span class="card-status pending">Pending</span>
                                <img src="/api/image?folder=${encodeURIComponent(data.path)}&filename=${encodeURIComponent(file)}" alt="${escapeHtml(file)}" loading="lazy">
                            </div>
                            <div class="card-content">
                                <div class="card-filename" title="${escapeHtml(file)}">${escapeHtml(file)}</div>
                                <div class="card-desc" id="desc-${safeId}">Waiting to process...</div>
                                <div class="card-actions">
                                    <button class="btn btn-small btn-primary-light btn-copy" data-file-id="${safeId}">Copy</button>
                                </div>
                            </div>
                        `;
                        els.galleryContainer.appendChild(card);
                    });

                    // Attach copy listeners
                    document.querySelectorAll('.btn-copy').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const fileId = e.target.getAttribute('data-file-id');
                            const descEl = document.getElementById(`desc-${fileId}`);
                            if (descEl && descEl.textContent) {
                                navigator.clipboard.writeText(descEl.textContent).then(() => {
                                    const original = e.target.textContent;
                                    e.target.textContent = 'Copied!';
                                    setTimeout(() => { e.target.textContent = original; }, 2000);
                                });
                            }
                        });
                    });
                }
            }
        }
    } catch (err) {
        console.error('Browse failed:', err);
    } finally {
        els.btnBrowse.disabled = false;
        els.btnBrowse.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Browse Folder`;
    }
}

// ─── Processing via Fetch/SSE ──────────────────────────────────────────
async function startProcessing() {
    if (state.processing || !state.folder) return;
    state.processing = true;

    // UI state
    els.btnStart.disabled = true;
    els.btnBrowse.disabled = true;
    els.progressSection.classList.remove('hidden');
    els.progressBar.style.width = '0%';

    // Build Payload
    const params = {
        folder: state.folder,
        model: els.modelName.value,
        prompt: els.promptText.value,
        preset: els.promptPreset.value,
        custom_instructions: els.customInstructions.value,
        output: els.outputName.value,
        concurrency: els.concurrency.value,
        skip_existing: els.skipExisting.checked
    };

    try {
        const response = await fetch('/api/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');

            // Keep the last incomplete fragment in the buffer
            buffer = lines.pop();

            for (let line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6);
                    try {
                        const data = JSON.parse(dataStr);
                        handleEvent(data);
                    } catch (e) {
                        console.error('Error parsing SSE json:', e, dataStr);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Fetch stream error:', err);
        handleEvent({ type: 'error', message: err.message });
    }
}

function handleEvent(data) {
    switch (data.type) {
        case 'start':
            els.progressLabel.textContent = `Processing ${data.total} images...`;
            els.progressCounter.textContent = `0 / ${data.total}`;
            break;

        case 'progress':
            els.progressLabel.textContent = `Processing: ${data.filename}`;
            els.progressLabel.classList.add('processing-pulse');
            updateCardStatus(data.filename, 'processing', 'Processing...');
            break;

        case 'chunk': {
            const safeId = data.filename.replace(/[^a-zA-Z0-9_-]/g, '_');
            const descEl = document.getElementById(`desc-${safeId}`);

            if (descEl) {
                // If it's the first chunk, clear the "Analyzing image..." text
                if (descEl.textContent === 'Analyzing image...') {
                    descEl.textContent = '';
                }
                descEl.textContent += data.chunk;

                // Auto-scroll to bottom of description
                descEl.scrollTop = descEl.scrollHeight;
            }
            break;
        }

        case 'result': {
            const pct = (data.current / data.total) * 100;
            els.progressBar.style.width = `${pct}%`;
            els.progressCounter.textContent = `${data.current} / ${data.total}`;
            els.progressLabel.classList.remove('processing-pulse');

            const isError = data.description.startsWith('[ERROR]');
            const statusMode = data.skipped ? 'skipped' : (isError ? 'error' : 'done');
            updateCardStatus(data.filename, statusMode, data.description);
            break;
        }

        case 'done':
            els.progressLabel.textContent = 'Complete!';
            els.progressBar.style.width = '100%';
            finishProcessing();
            break;

        case 'error':
            els.progressLabel.textContent = `Error: ${data.message}`;
            finishProcessing();
            break;
    }
}

function updateCardStatus(filename, status, description) {
    const safeId = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    const card = document.getElementById(`card-${safeId}`);
    const descEl = document.getElementById(`desc-${safeId}`);

    if (!card || !descEl) return;

    const statusBadge = card.querySelector('.card-status');
    if (statusBadge) statusBadge.className = `card-status ${status}`;

    if (status === 'processing') {
        if (statusBadge) statusBadge.textContent = 'Processing';
        card.className = 'image-card processing';
        descEl.textContent = 'Analyzing image...';
        descEl.classList.remove('error-text');
    } else if (status === 'error') {
        if (statusBadge) statusBadge.textContent = 'Error';
        card.className = 'image-card error';
        descEl.textContent = description || 'An error occurred';
        descEl.classList.add('error-text');
    } else if (status === 'done') {
        if (statusBadge) statusBadge.textContent = 'Done';
        card.className = 'image-card done';
        descEl.textContent = description || '';
        descEl.classList.remove('error-text');
    } else if (status === 'skipped') {
        if (statusBadge) statusBadge.textContent = 'Skipped';
        card.className = 'image-card skipped';
        descEl.textContent = description || '';
        descEl.classList.remove('error-text');
    }
}

function finishProcessing() {
    state.processing = false;
    els.btnStart.disabled = false;
    els.btnBrowse.disabled = false;
}

// ─── Util ────────────────────────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Settings Persistence ──────────────────────────────────────────────
const SETTINGS_KEY = 'imageDescriberSettings';

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;

    try {
        const data = JSON.parse(saved);
        if (data.modelName) els.modelName.value = data.modelName;
        if (data.promptText) els.promptText.value = data.promptText;
        if (data.customInstructions) els.customInstructions.value = data.customInstructions;
        if (data.outputName) els.outputName.value = data.outputName;

        if (data.concurrency) {
            els.concurrency.value = data.concurrency;
            els.concurrencyVal.textContent = data.concurrency;
        }
        if (data.skipExisting !== undefined) {
            els.skipExisting.checked = data.skipExisting;
        }

        if (data.promptPreset) {
            els.promptPreset.value = data.promptPreset;
            toggleBasePromptVisibility();
        }
    } catch (e) {
        console.warn('Failed to parse settings', e);
    }
}

function toggleBasePromptVisibility() {
    if (els.promptPreset.value === 'None') {
        els.basePromptGroup.style.display = 'flex';
    } else {
        els.basePromptGroup.style.display = 'none';
    }
}

function saveSettings() {
    const data = {
        modelName: els.modelName.value,
        promptText: els.promptText.value,
        promptPreset: els.promptPreset.value,
        customInstructions: els.customInstructions.value,
        outputName: els.outputName.value,
        concurrency: els.concurrency.value,
        skipExisting: els.skipExisting.checked
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

function attachSettingsListeners() {
    [els.modelName, els.promptText, els.promptPreset, els.customInstructions, els.outputName, els.concurrency, els.skipExisting].forEach(el => {
        el.addEventListener('input', saveSettings);
        el.addEventListener('change', saveSettings);
    });

    els.concurrency.addEventListener('input', (e) => {
        els.concurrencyVal.textContent = e.target.value;
    });

    // Toggle base prompt visibility when preset changes
    els.promptPreset.addEventListener('change', toggleBasePromptVisibility);
}

// ─── Init ────────────────────────────────────────────────────────────
els.btnCheckHealth.addEventListener('click', checkHealth);
els.btnBrowse.addEventListener('click', browseFolder);
els.btnStart.addEventListener('click', startProcessing);

// Auto-check health on load
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    attachSettingsListeners();
    checkHealth();
});
