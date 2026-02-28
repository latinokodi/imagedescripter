import { useState, useRef, useEffect } from 'react';
import { Play, FolderOpen } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ImageCard from './components/ImageCard';
import { cn } from './lib/utils';

function App() {
  const [images, setImages] = useState([]);
  const [folder, setFolder] = useState('');
  const [config, setConfig] = useState({
    modelName: '',
    systemPrompt: 'You are an intelligent assistant. You always provide helpful answers.',
    userPrompt: 'Describe this image in detail.',
    selectedPreset: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);

  // Auto-connect to SSE
  useEffect(() => {
    const evtSource = new EventSource('/api/stream');
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status') {
        if (data.file === '__all__') {
          if (data.status === 'complete' || data.status === 'stopped') setIsProcessing(false);
        } else {
          updateImageRecord(data.file, { status: data.status, error: data.error });
        }
      } else if (data.type === 'token') {
        updateImageRecord(data.file, { description: data.description, status: 'processing' });
      } else if (data.type === 'done') {
        updateImageRecord(data.file, { status: 'done', description: data.description });
      }
    };
    return () => evtSource.close();
  }, []);

  const updateImageRecord = (filename, payload) => {
    setImages((prev) =>
      prev.map(img => img.filename === filename ? { ...img, ...payload } : img)
    );
  };

  const handleCopyAll = () => {
    // Collect all descriptions and copy to clipboard
    const text = images.filter(i => i.description).map(i => i.description).join('\n\n');
    navigator.clipboard.writeText(text);
  };

  const handleStart = async () => {
    setIsProcessing(true);
    // Mark ALL selected & non-done images as pending
    setImages(imgs => imgs.map(i => (i.selected && i.status !== 'done') ? { ...i, status: 'pending', description: '', error: null } : i));
    try {
      await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, files: images.filter(i => i.selected && i.status !== 'done').map(i => i.filename), folder })
      });
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    try {
      await fetch('/api/stop', { method: 'POST' });
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
    }
  };

  const browseFolder = async () => {
    try {
      const res = await fetch('/api/dialog/folder');
      const data = await res.json();
      if (data.folder) {
        setFolder(data.folder);
        loadImages(data.folder);
      }
    } catch (err) {
      console.error("Failed to browse", err);
    }
  };

  const loadImages = async (path) => {
    try {
      const res = await fetch(`/api/images?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setImages(data.files.map(f => ({
        filename: f,
        status: 'idle', // idle, pending, processing, done, error
        description: '',
        error: '',
        selected: false,
      })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleSelect = (filename) => {
    setImages(imgs => imgs.map(i => i.filename === filename ? { ...i, selected: !i.selected } : i));
  };

  const handleSelectAll = () => setImages(imgs => imgs.map(i => ({ ...i, selected: true })));
  const handleSelectNone = () => setImages(imgs => imgs.map(i => ({ ...i, selected: false })));

  const selectedCount = images.filter(i => i.selected).length;

  return (
    <div className="h-screen w-full bg-[#050505] flex overflow-hidden selection:bg-primary/30">
      {/* Sidebar fixed left */}
      <Sidebar
        config={config}
        setConfig={setConfig}
        onCopyAll={handleCopyAll}
        isProcessing={isProcessing}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full bg-grid-pattern relative">
        <div className="absolute inset-0 bg-gradient-radial from-transparent to-[#050505] pointer-events-none" />

        {/* Top Header / Action Bar */}
        <header className="relative z-10 px-8 py-5 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <button
              onClick={browseFolder}
              disabled={isProcessing}
              className="btn bg-white/5 hover:bg-white/10 text-white border border-white/10 px-4 py-2 disabled:opacity-50"
            >
              <FolderOpen size={16} />
              Browse Folder
            </button>
            <div className="text-sm font-mono text-white/50 truncate max-w-[400px]">
              {folder || 'No folder selected'}
            </div>
            {images.length > 0 && (
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs bg-white/5 px-2 py-1 rounded text-white/40 border border-white/5">
                  {images.length} images
                </span>
                <div className="flex items-center gap-1 border-l border-white/10 pl-3">
                  <button onClick={handleSelectAll} className="text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/5 transition-colors">Select All</button>
                  <button onClick={handleSelectNone} className="text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/5 transition-colors">None</button>
                  <span className="text-xs text-blue-400 font-mono ml-2 border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 rounded flex items-center gap-1">
                    {selectedCount} selected
                  </span>
                </div>
              </div>
            )}
          </div>

          {!isProcessing ? (
            <button
              onClick={handleStart}
              disabled={selectedCount === 0}
              className={cn(
                "btn border border-transparent bg-white text-black hover:bg-white/90 px-6 py-2.5 font-bold shadow-xl overflow-hidden relative",
                selectedCount === 0 && "opacity-50 cursor-not-allowed"
              )}
            >
              <Play size={16} fill="currentColor" />
              Process Selected
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end mr-2">
                <span className="text-xs text-white/50 font-medium">Processing Queue</span>
                <span className="text-sm text-yellow-400 font-mono font-bold">{images.filter(i => ['done', 'error'].includes(i.status)).length} / {images.filter(i => ['pending', 'processing', 'done', 'error'].includes(i.status)).length}</span>
              </div>
              <button
                onClick={handleStop}
                className="btn border border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-6 py-2.5 font-bold shadow-xl relative"
              >
                <div className="w-4 h-4 bg-red-500 rounded-sm animate-pulse" />
                Stop Processing
              </button>
            </div>
          )}

          {/* Progress Bar overlay at the bottom of header */}
          {isProcessing && (
            <div className="absolute bottom-0 left-0 h-1 bg-green-500 transition-all duration-300 ease-out"
              style={{ width: `${(images.filter(i => ['done', 'error'].includes(i.status)).length / Math.max(1, images.filter(i => ['pending', 'processing', 'done', 'error'].includes(i.status)).length)) * 100}%` }} />
          )}
        </header>

        {/* Scrollable Gallery */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {images.length === 0 ? (
            <div className="h-full w-full flex items-center justify-center text-white/20 font-bold text-2xl tracking-tight">
              SELECT A FOLDER TO BEGIN
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6 content-start">
              {images.map((img) => (
                <ImageCard
                  key={img.filename}
                  folder={folder}
                  image={img}
                  config={config}
                  onToggleSelect={() => handleToggleSelect(img.filename)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
