import React, { useState } from 'react';

interface TickerManagementPanelProps {
    tickers: string[];
    onAddTicker: (ticker: string) => void;
    onRemoveTicker: (ticker: string) => void;
    onSelectTicker: (ticker: string) => void;
    activeTicker?: string | null;
}

const TickerManagementPanel: React.FC<TickerManagementPanelProps> = ({
    tickers,
    onAddTicker,
    onRemoveTicker,
    onSelectTicker,
    activeTicker
}) => {
    const [newTicker, setNewTicker] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTicker.trim()) {
            onAddTicker(newTicker.trim().toUpperCase());
            setNewTicker('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 w-full">
            <div className="p-4 border-b border-slate-800">
                <h2 className="text-xl font-bold text-white mb-1">Watchlist</h2>
                <p className="text-xs text-slate-400">Manage tracked assets</p>
            </div>

            <div className="p-4 border-b border-slate-800">
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={newTicker}
                        onChange={(e) => setNewTicker(e.target.value)}
                        placeholder="Symbol (e.g. MSFT)"
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md font-semibold text-sm transition-colors"
                    >
                        Add
                    </button>
                </form>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {tickers.length === 0 && (
                    <div className="text-center text-slate-500 mt-10 px-4">
                        <p>No tickers tracked.</p>
                        <p className="text-xs mt-2">Add a symbol above to start tracking.</p>
                    </div>
                )}

                {tickers.map((ticker) => (
                    <div
                        key={ticker}
                        onClick={() => onSelectTicker(ticker)}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer group transition-all ${ticker === activeTicker
                                ? 'bg-slate-800 border-indigo-500 shadow-md shadow-indigo-500/10'
                                : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                            }`}
                    >
                        <span className="font-bold text-lg text-white">{ticker}</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemoveTicker(ticker);
                            }}
                            className="text-slate-500 hover:text-red-400 p-1 rounded-md hover:bg-red-400/10 transition-colors"
                            title="Remove Ticker"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TickerManagementPanel;
