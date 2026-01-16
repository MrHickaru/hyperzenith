import { useState, useEffect } from 'react';

interface BuildProgressProps {
    isVisible: boolean;
    currentLine: string;
    progress: number;
    onClose: () => void;
}

const LOADING_TIPS = [
    "☕ Time for coffee! Builds are a great excuse for a break.",
    "💡 Pro tip: Clean builds take longer but fix weird issues.",
    "🌍 Fun fact: Gradle was named after the German word for 'degree'.",
    "🚀 Your i9-10850K has 20 threads. That's more than most servers!",
    "🧠 Programming is like cooking. Sometimes you just need to let it simmer.",
    "📦 An APK is just a fancy ZIP file. Seriously, rename it and open it!",
    "🎮 Loading screens in games serve the same purpose as this one.",
    "✨ Every great app started with a 'Hello World'.",
    "🔥 Your RTX 3070Ti could mine crypto, but building apps is more fun.",
    "🧩 Debugging is like being a detective in a crime movie where you're also the murderer.",
    "🌙 Night builds are 10% faster. (We made that up, but it feels true.)",
    "📱 The first Android phone, the HTC Dream, had 192MB of RAM. Your build uses more.",
    "🎯 'It works on my machine' is the official motto of developers everywhere.",
    "💾 Remember floppy disks? A single APK wouldn't fit on one.",
    "🏎️ HyperZenith is pushing your hardware harder than most games right now.",
];

export const BuildProgress = ({ isVisible, currentLine, progress, onClose }: BuildProgressProps) => {
    const [tipIndex, setTipIndex] = useState(0);
    const [displayProgress, setDisplayProgress] = useState(0);

    // Rotate tips every 5 seconds
    useEffect(() => {
        if (!isVisible) return;
        const interval = setInterval(() => {
            setTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [isVisible]);

    // Smooth progress animation
    useEffect(() => {
        const step = (progress - displayProgress) * 0.1;
        if (Math.abs(step) > 0.1) {
            const timeout = setTimeout(() => setDisplayProgress(prev => prev + step), 50);
            return () => clearTimeout(timeout);
        }
    }, [progress, displayProgress]);

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-8">
            {/* Animated Background Grid */}
            <div className="absolute inset-0 overflow-hidden opacity-20">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'linear-gradient(#ff005520 1px, transparent 1px), linear-gradient(90deg, #ff005520 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                    animation: 'pulse 2s ease-in-out infinite'
                }} />
            </div>

            {/* Content */}
            <div className="relative z-10 w-full max-w-2xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <h2 className="text-4xl font-black text-white mb-2">
                        BUILD<span className="text-[#ff0055]">ING</span>
                    </h2>
                    <div className="text-cyan-500 text-sm tracking-widest uppercase animate-pulse">
                        ⚡ Hardware Overclocked
                    </div>
                </div>

                {/* Progress Bar Container */}
                <div className="mb-8">
                    <div className="flex justify-between text-xs text-slate-400 mb-2">
                        <span>PROGRESS</span>
                        <span className="text-white font-bold">{Math.round(displayProgress)}%</span>
                    </div>

                    {/* Outer Track */}
                    <div className="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-700 relative">
                        {/* Animated Background */}
                        <div
                            className="absolute inset-0 opacity-30"
                            style={{
                                background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, #ff005510 10px, #ff005510 20px)',
                                animation: 'slide 1s linear infinite'
                            }}
                        />

                        {/* Progress Fill */}
                        <div
                            className="h-full bg-gradient-to-r from-[#ff0055] via-[#ff0080] to-[#ff0055] rounded-full transition-all duration-300 relative overflow-hidden"
                            style={{ width: `${displayProgress}%` }}
                        >
                            {/* Shimmer Effect */}
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                                    animation: 'shimmer 1.5s infinite'
                                }}
                            />
                        </div>
                    </div>

                    {/* Phase Indicator */}
                    <div className="flex justify-between text-[10px] text-slate-500 mt-2 uppercase">
                        <span className={displayProgress > 0 ? 'text-cyan-500' : ''}>Init</span>
                        <span className={displayProgress > 20 ? 'text-cyan-500' : ''}>Dependencies</span>
                        <span className={displayProgress > 50 ? 'text-cyan-500' : ''}>Compile</span>
                        <span className={displayProgress > 80 ? 'text-cyan-500' : ''}>Bundle</span>
                        <span className={displayProgress > 95 ? 'text-emerald-500' : ''}>Done</span>
                    </div>
                </div>

                {/* Current Task */}
                <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-4 mb-6">
                    <div className="text-[10px] text-slate-500 uppercase mb-1">Current Task</div>
                    <div className="text-cyan-400 font-mono text-sm truncate">
                        {currentLine || "Initializing build system..."}
                    </div>
                </div>

                {/* Loading Tip */}
                <div className="bg-[#ff0055]/10 border border-[#ff0055]/30 rounded-lg p-4 text-center">
                    <div className="text-[10px] text-[#ff0055] uppercase tracking-widest mb-2">💡 Did You Know?</div>
                    <div className="text-white text-sm transition-all duration-500">
                        {LOADING_TIPS[tipIndex]}
                    </div>
                </div>

                {/* Cancel Button */}
                <button
                    onClick={onClose}
                    className="mt-6 w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-bold uppercase tracking-widest transition-all border border-slate-600"
                >
                    Cancel Build
                </button>
            </div>

            {/* CSS Animations */}
            <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes slide {
          0% { transform: translateX(0); }
          100% { transform: translateX(40px); }
        }
      `}</style>
        </div>
    );
};
