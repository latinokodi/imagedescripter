import { useState, useEffect } from 'react';
import { Settings, Save, Copy, ChevronDown, RotateCcw, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar({ config, setConfig, onCopyAll, isProcessing }) {
    const [presets, setPresets] = useState({});
    const [saved, setSaved] = useState(false);

    // On mount: load presets, then load saved config on top
    useEffect(() => {
        Promise.all([
            fetch('/api/system_prompts').then(r => r.json()),
            fetch('/api/load_config').then(r => r.json()),
        ]).then(([promptsData, savedConfig]) => {
            const prompts = promptsData.prompts || {};
            setPresets(prompts);
            const presetKeys = Object.keys(prompts);

            if (savedConfig && savedConfig.systemPrompt) {
                // Restore saved config (system prompt, user prompt, selected preset)
                setConfig(prev => ({
                    ...prev,
                    systemPrompt: savedConfig.systemPrompt,
                    userPrompt: savedConfig.userPrompt || prev.userPrompt,
                    modelName: savedConfig.modelName || prev.modelName,
                    selectedPreset: savedConfig.selectedPreset || presetKeys[0] || '',
                }));
            } else if (presetKeys.length > 0) {
                // First run: use first preset
                const first = presetKeys[0];
                setConfig(prev => ({
                    ...prev,
                    systemPrompt: prompts[first],
                    selectedPreset: first,
                }));
            }
        }).catch(err => console.error('Failed to load config/prompts:', err));
    }, []);

    const handleChange = (field, val) => {
        setConfig(prev => ({ ...prev, [field]: val }));
    };

    const handlePresetChange = (label) => {
        setConfig(prev => ({
            ...prev,
            selectedPreset: label,
            systemPrompt: presets[label] || prev.systemPrompt,
        }));
    };

    const handleSave = async () => {
        try {
            await fetch('/api/save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            console.error(e);
        }
    };

    const handleRestore = () => {
        const preset = config.selectedPreset;
        if (preset && presets[preset]) {
            setConfig(prev => ({ ...prev, systemPrompt: presets[preset] }));
        }
    };

    const presetKeys = Object.keys(presets);
    const isDirty = config.selectedPreset
        && presets[config.selectedPreset] !== undefined
        && config.systemPrompt !== presets[config.selectedPreset];

    return (
        <aside className="w-[340px] shrink-0 glass-panel border-y-0 border-l-0 border-r border-[var(--color-glass-border)] flex flex-col h-full z-20">
            <div className="p-6 flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar">
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                    <div className="bg-primary/20 p-2.5 rounded-xl border border-primary/30">
                        <Settings size={22} className="text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white tracking-tight">Vision Agent</h1>
                        <p className="text-xs text-white/40 font-mono">LM Studio Integration</p>
                    </div>
                </div>

                {/* Config Form */}
                <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">Model Name (Optional)</label>
                        <input
                            type="text"
                            className="input-modern placeholder-white/30"
                            placeholder="Auto-detect if blank"
                            value={config.modelName}
                            onChange={(e) => handleChange('modelName', e.target.value)}
                        />
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">System Prompt</label>
                            {isDirty && (
                                <button
                                    onClick={handleRestore}
                                    title="Restore to preset default"
                                    className="flex items-center gap-1 text-xs text-primary/80 hover:text-primary transition-colors"
                                >
                                    <RotateCcw size={11} />
                                    Restore default
                                </button>
                            )}
                        </div>

                        {presetKeys.length > 0 ? (
                            <>
                                <div className="relative">
                                    <select
                                        className={cn(
                                            "input-modern appearance-none pr-8 cursor-pointer",
                                            "bg-black/40 border border-white/10 text-white"
                                        )}
                                        value={config.selectedPreset}
                                        onChange={(e) => handlePresetChange(e.target.value)}
                                    >
                                        {presetKeys.map(key => (
                                            <option key={key} value={key} className="bg-[#0b0c10] text-white">
                                                {key}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown
                                        size={14}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
                                    />
                                </div>

                                <textarea
                                    className={cn(
                                        "input-modern min-h-[100px] resize-y mt-2 text-xs font-mono",
                                        isDirty && "border-yellow-400/30 bg-yellow-400/5"
                                    )}
                                    value={config.systemPrompt}
                                    onChange={(e) => handleChange('systemPrompt', e.target.value)}
                                />
                            </>
                        ) : (
                            <textarea
                                className="input-modern min-h-[100px] resize-y"
                                placeholder="Preset prompts not found — enter manually"
                                value={config.systemPrompt}
                                onChange={(e) => handleChange('systemPrompt', e.target.value)}
                            />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">User Prompt (Instructions)</label>
                        <textarea
                            className="input-modern min-h-[120px] resize-y border-primary/30 bg-primary/5 focus:border-primary focus:ring-primary/20"
                            value={config.userPrompt}
                            onChange={(e) => handleChange('userPrompt', e.target.value)}
                        />
                    </div>
                </div>

                {/* Global Actions */}
                <div className="mt-auto pt-6 flex flex-col gap-3">
                    <div className="relative">
                        <button
                            onClick={handleSave}
                            className="btn btn-secondary w-full py-2.5 font-medium"
                        >
                            <Save size={16} /> Save Configuration
                        </button>
                        <AnimatePresence>
                            {saved && (
                                <motion.span
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-400 font-medium flex items-center gap-1"
                                >
                                    <CheckCircle2 size={12} /> Saved!
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        onClick={onCopyAll}
                        className="btn w-full py-2.5 font-medium bg-white/5 hover:bg-white/10 border border-white/5 text-white/80 transition-colors"
                    >
                        <Copy size={16} /> Copy All Output
                    </button>
                </div>
            </div>
        </aside>
    );
}
