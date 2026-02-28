import { useState } from 'react';
import { Copy, ImageIcon, AlertCircle, CheckCircle2, Clock, Loader2, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function ImageCard({ folder, image, config, onToggleSelect }) {
    const { filename, status, description, error, selected } = image;
    const [copied, setCopied] = useState(false);

    const imageUrl = `/api/image?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`;

    const handleCopy = () => {
        if (!description) return;
        navigator.clipboard.writeText(description).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const getStatusConfig = (s) => {
        switch (s) {
            case 'processing': return { icon: Loader2, color: 'text-yellow-400', bg: 'bg-yellow-400/20', border: 'border-yellow-400/30', label: 'Processing', spin: true };
            case 'pending': return { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-400/20', border: 'border-blue-400/30', label: 'In Queue', spin: false };
            case 'done': return { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-400/20', border: 'border-green-400/30', label: 'Done', spin: false };
            case 'error': return { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/20', border: 'border-red-400/30', label: 'Error', spin: false };
            default: return { icon: ImageIcon, color: 'text-gray-400', bg: 'bg-gray-400/20', border: 'border-gray-400/30', label: 'Idle', spin: false };
        }
    };

    const statusConfig = getStatusConfig(status);
    const StatusIcon = statusConfig.icon;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "glass-panel rounded-xl overflow-hidden flex flex-col transition-all duration-300 relative",
                status === 'processing' && "ring-1 ring-yellow-400/30 shadow-[0_0_20px_rgba(250,204,21,0.1)]",
                status === 'error' && "ring-1 ring-red-500/30",
                selected && status !== 'processing' && status !== 'error' && "ring-1 ring-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
            )}
        >
            {/* Image */}
            <div className="relative w-full aspect-square bg-black/60 shrink-0 border-b border-white/5 overflow-hidden group cursor-pointer" onClick={onToggleSelect}>
                {/* Checkbox Overlay */}
                <div className="absolute top-3 left-3 z-20 flex items-center justify-center">
                    <div className={cn(
                        "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                        selected ? "bg-blue-500 border-blue-500 text-white" : "bg-black/40 border-white/30 text-transparent group-hover:border-white/60"
                    )}>
                        <CheckCircle2 size={14} className={cn(!selected && "hidden")} />
                    </div>
                </div>

                <div className={cn(
                    "absolute top-3 right-3 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 z-10 backdrop-blur-md border",
                    statusConfig.bg, statusConfig.color, statusConfig.border
                )}>
                    <StatusIcon size={14} className={cn(statusConfig.spin && "animate-spin")} />
                    {statusConfig.label}
                </div>
                <img
                    src={imageUrl}
                    alt={filename}
                    loading="lazy"
                    className={cn(
                        "absolute inset-0 w-full h-full object-contain bg-transparent transition-transform duration-500 group-hover:scale-105",
                        selected && "opacity-80"
                    )}
                />
            </div>

            {/* Content */}
            <div className="flex flex-col bg-transparent">
                {/* Filename */}
                <div className="px-4 py-3 border-b border-white/5 bg-black/20 shrink-0">
                    <h3 className="font-mono text-xs text-white/90 truncate" title={filename}>
                        {filename}
                    </h3>
                </div>

                {/* Description — fixed height, scrollable */}
                <div className="px-4 pt-3 pb-2">
                    <div className={cn(
                        "h-[100px] overflow-y-auto text-[11px] leading-relaxed custom-scrollbar pr-1",
                        status === 'error' ? "text-red-400/90" : "text-white/70",
                        status === 'pending' && "flex items-center justify-center text-blue-300 font-mono"
                    )}>
                        {status === 'pending' ? (
                            "Waiting in queue..."
                        ) : status === 'error' ? (
                            <span className="whitespace-pre-wrap">{error || "Generation failed."}</span>
                        ) : (
                            <div className="whitespace-pre-wrap">
                                {description || <span className="animate-pulse text-white/30">Generating...</span>}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/5 shrink-0 flex justify-end relative gap-2">
                    {/* Toast */}
                    <AnimatePresence>
                        {copied && (
                            <motion.span
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-xs text-green-400 font-medium flex items-center gap-1"
                            >
                                <CheckCircle2 size={12} /> Copied!
                            </motion.span>
                        )}
                    </AnimatePresence>

                    <button
                        onClick={handleCopy}
                        disabled={!description}
                        className="btn bg-white/5 hover:bg-white/10 text-white/90 border border-white/5 py-1.5 px-3 disabled:opacity-30 disabled:hover:bg-white/5 text-xs font-medium"
                    >
                        <Copy size={13} />
                        Copy
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
