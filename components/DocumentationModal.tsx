import React from 'react';

interface DocumentationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const DocumentationModal: React.FC<DocumentationModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    const sections = [
        {
            title: "1. Hidden Divergence",
            tag: "TREND CONTINUATION",
            color: "amber",
            content: "Unlike regular divergence which signals a reversal, Hidden Divergence suggests the current trend is likely to continue. It occurs when price makes a Higher Low (in an uptrend) while the indicator makes a Lower Low, indicating hidden momentum building behind the trend."
        },
        {
            title: "2. Extreme Zone (OB/OS)",
            tag: "PROBABILITY FILTER",
            color: "rose",
            content: "Statistical probability of a reversal increases when a divergence occurs within 'Extreme' indicator zones. For RSI, we flag signals that print below 35 (Oversold) or above 65 (Overbought), filtering out weak signals in the neutral range."
        },
        {
            title: "3. Signal Strength",
            tag: "CONVICTION SCORE",
            color: "indigo",
            content: "Every signal is assigned a 0-100 score based on the 'slope divergence' and the amount of price movement between pivots. A score of 80%+ indicates a very sharp divergence between price and momentum, usually leading to more explosive moves."
        },
        {
            title: "4. Convergence (Double Divergence)",
            tag: "MULTI-INDICATOR CONFIRMATION",
            color: "cyan",
            content: "Convergence occurs when both RSI and MACD detect the same divergence on the same timeframe. This 'Double Divergence' is one of the highest conviction setups, as it confirms that exhaustion is visible across both momentum and trend-following metrics."
        },
        {
            title: "5. Triple Divergence",
            tag: "COMPLEX STRUCTURE",
            color: "purple",
            content: "A Triple Divergence involves three consecutive price pivots and three corresponding indicator pivots. This suggests that the trend has attempted to push three times without momentum support, indicating high-level exhaustion and a massive pending shift."
        },
        {
            title: "6. Scan Sensitivity",
            tag: "PIVOT DEPTH",
            color: "emerald",
            content: "FAST sensitivity uses small pivot windows, great for finding short-term intraday scalps. SLOW sensitivity uses wider windows, filtering out noise and highlighting major swing reversals on higher timeframes like 4H and 1D."
        }
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Advanced Assessment Guide</h2>
                        <p className="text-slate-400 text-sm mt-1">Understanding high-conviction divergence signals</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-1 gap-6">
                        {sections.map((section, idx) => (
                            <div
                                key={idx}
                                className="p-4 rounded-xl bg-slate-800/40 border border-slate-800/60 hover:border-slate-700 transition-all hover:bg-slate-800/60 group"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-bold text-lg text-white group-hover:text-indigo-400 transition-colors">
                                        {section.title}
                                    </h3>
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${section.color === 'amber' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                            section.color === 'rose' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                                section.color === 'indigo' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                                                    section.color === 'cyan' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                                                        section.color === 'purple' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                                                            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        }`}>
                                        {section.tag}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-400 leading-relaxed">
                                    {section.content}
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10 text-center">
                        <p className="text-xs text-indigo-300 italic">
                            "System note: Advanced logic parameters can be adjusted in the Filter Panel for custom tuning."
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-all shadow-lg shadow-indigo-500/20"
                    >
                        Got it!
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DocumentationModal;
