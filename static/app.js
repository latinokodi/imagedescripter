/**
 * Image Describer — Frontend Logic
 * Handles folder selection, SSE processing stream, and UI state.
 */

// ─── DOM Refs ────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const els = {
    apiUrl: $('#apiUrl'),
    apiHint: $('#apiHint'),
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
    logContainer: $('#logContainer'),
    resultSection: $('#resultSection'),
    resultPath: $('#resultPath'),
    resultContent: $('#resultContent'),
    btnCopy: $('#btnCopy'),
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
                api_url: els.apiUrl.value,
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

// ─── Processing via SSE ──────────────────────────────────────────────
function startProcessing() {
    if (state.processing || !state.folder) return;
    state.processing = true;

    // UI state
    els.btnStart.disabled = true;
    els.btnBrowse.disabled = true;
    els.progressSection.classList.remove('hidden');
    els.resultSection.classList.add('hidden');
    els.logContainer.innerHTML = '';
    els.progressBar.style.width = '0%';

    // Build SSE URL
    const params = new URLSearchParams({
        folder: state.folder,
        api_url: els.apiUrl.value,
        model: els.modelName.value,
        prompt: els.promptText.value,
        prompt_preset: els.promptPreset.value, // Swapped 'length' with 'prompt_preset'
        custom_instructions: els.customInstructions.value,
        output: els.outputName.value,
        concurrency: els.concurrency.value,
        skip_existing: els.skipExisting.checked
    });

    const source = new EventSource(`/api/process?${params.toString()}`);

    source.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleEvent(data, source);
    };

    source.onerror = () => {
        source.close();
        finishProcessing();
    };
}

function handleEvent(data, source) {
    switch (data.type) {
        case 'start':
            els.progressLabel.textContent = `Processing ${data.total} images...`;
            els.progressCounter.textContent = `0 / ${data.total}`;
            break;

        case 'progress':
            els.progressLabel.textContent = `Processing: ${data.filename}`;
            els.progressLabel.classList.add('processing-pulse');
            updateLogEntry(data.filename, 'processing', null);
            break;

        case 'result': {
            const pct = (data.current / data.total) * 100;
            els.progressBar.style.width = `${pct}%`;
            els.progressCounter.textContent = `${data.current} / ${data.total}`;
            els.progressLabel.classList.remove('processing-pulse');

            const isError = data.description.startsWith('[ERROR]');
            updateLogEntry(data.filename, isError ? 'error' : 'done', data.description);
            break;
        }

        case 'done':
            source.close();
            els.progressLabel.textContent = 'Complete!';
            els.progressBar.style.width = '100%';

            // Show result
            els.resultSection.classList.remove('hidden');
            els.resultPath.textContent = `Saved to: ${data.output_path}`;
            els.resultContent.textContent = data.markdown;

            finishProcessing();
            break;

        case 'error':
            source.close();
            els.progressLabel.textContent = `Error: ${data.message}`;
            finishProcessing();
            break;
    }
}

function updateLogEntry(filename, status, description) {
    // Find or create entry
    let entry = document.getElementById(`log-${filename}`);

    if (!entry) {
        entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.id = `log-${filename}`;
        els.logContainer.appendChild(entry);
    }

    const statusLabel = status === 'processing' ? 'Processing...'
        : status === 'error' ? 'Error'
            : 'Done';

    entry.innerHTML = `
        <div class="log-entry-header">
            <span class="log-entry-filename">${escapeHtml(filename)}</span>
            <span class="log-entry-status ${status}">${statusLabel}</span>
        </div>
        ${description ? `<div class="log-entry-desc">${escapeHtml(description)}</div>` : ''}
    `;

    // Auto-scroll
    els.logContainer.scrollTop = els.logContainer.scrollHeight;
}

function finishProcessing() {
    state.processing = false;
    els.btnStart.disabled = false;
    els.btnBrowse.disabled = false;
}

// ─── Copy ────────────────────────────────────────────────────────────
function copyMarkdown() {
    const text = els.resultContent.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const original = els.btnCopy.textContent;
        els.btnCopy.textContent = 'Copied!';
        setTimeout(() => { els.btnCopy.textContent = original; }, 2000);
    });
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
        if (data.apiUrl) els.apiUrl.value = data.apiUrl;
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
        apiUrl: els.apiUrl.value,
        modelName: els.modelName.value,
        promptText: els.promptText.value,
        promptPreset: els.promptPreset.value,
        customInstructions: els.customInstructions.value,
        outputName: els.outputName.value,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

function attachSettingsListeners() {
    [els.apiUrl, els.modelName, els.promptText, els.promptPreset, els.customInstructions, els.outputName].forEach(el => {
        el.addEventListener('input', saveSettings);
    });

    // Toggle base prompt visibility when preset changes
    els.promptPreset.addEventListener('change', toggleBasePromptVisibility);
}

// ─── Init ────────────────────────────────────────────────────────────
els.btnCheckHealth.addEventListener('click', checkHealth);
els.btnBrowse.addEventListener('click', browseFolder);
els.btnStart.addEventListener('click', startProcessing);
els.btnCopy.addEventListener('click', copyMarkdown);

// Auto-check health on load
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    attachSettingsListeners();
    checkHealth();
});
