import React, { useState, useEffect, useRef } from 'react';
import { searchTickers, MarketType } from '../services/dataService';
import { api } from '../services/api';
import { TickerSearchResult } from '../types';

interface TickerManagementPanelProps {
    tickers: string[];
    onAddTicker: (ticker: string, marketType: MarketType) => void;
    onRemoveTicker: (ticker: string) => void;
    onSelectTicker: (ticker: string) => void;
    activeTicker?: string | null;
    tickerNotes?: Record<string, { note: string; date: string }[]>; // ticker -> array of notes with dates
    openTrades?: Set<string>;
    syncingTickers?: Set<string>;
}

const TickerManagementPanel: React.FC<TickerManagementPanelProps> = ({
    tickers,
    onAddTicker,
    onRemoveTicker,
    onSelectTicker,
    activeTicker,
    tickerNotes = {},
    openTrades = new Set(),
    syncingTickers = new Set()
}) => {
    const [inputValue, setInputValue] = useState('');
    const [results, setResults] = useState<TickerSearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [expandedNotesTicker, setExpandedNotesTicker] = useState<string | null>(null);
    const [marketType, setMarketType] = useState<MarketType>(() => {
        // Load from localStorage or default to STOCKS
        const saved = localStorage.getItem('watchlistMarketType');
        return (saved === 'CRYPTO' ? 'CRYPTO' : 'STOCKS') as MarketType;
    });
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Filter tickers based on marketType from database
    const [filteredTickers, setFilteredTickers] = useState<{ ticker: string, added_at: string, business_score?: string }[]>([]);
    const [sortOrder, setSortOrder] = useState<'ALPHA' | 'NEWEST'>('ALPHA');

    // Load and filter tickers based on marketType
    useEffect(() => {
        const filterTickers = async () => {
            try {
                const allWatchlist = await api.getWatchlist();
                const filtered = allWatchlist
                    .filter((w: any) => w.market_type === marketType)
                    .map((w: any) => ({
                        ticker: w.ticker,
                        added_at: w.added_at,
                        business_score: w.business_score
                    }));
                setFilteredTickers(filtered);
            } catch (e) {
                console.error("Failed to filter tickers", e);
            }
        };
        filterTickers();
    }, [marketType, tickers]); // Re-filter when marketType or tickers change

    // Listen for business analysis updates to refresh the watchlist
    useEffect(() => {
        const handleBusinessAnalysisUpdate = async () => {
            // Refresh the watchlist to get updated business scores
            try {
                const allWatchlist = await api.getWatchlist();
                const filtered = allWatchlist
                    .filter((w: any) => w.market_type === marketType)
                    .map((w: any) => ({
                        ticker: w.ticker,
                        added_at: w.added_at,
                        business_score: w.business_score
                    }));
                setFilteredTickers(filtered);
            } catch (e) {
                console.error("Failed to refresh watchlist after analysis update", e);
            }
        };

        window.addEventListener('businessAnalysisUpdated', handleBusinessAnalysisUpdate as EventListener);

        return () => {
            window.removeEventListener('businessAnalysisUpdated', handleBusinessAnalysisUpdate as EventListener);
        };
    }, [marketType]); // Include marketType in dependency

    // Save market type to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('watchlistMarketType', marketType);
        // Clear search results when switching market type
        setResults([]);
        setShowDropdown(false);
    }, [marketType]);

    // Debounce Search
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (inputValue.length >= 2) {
                setIsLoading(true);
                try {
                    console.log(`🔍 Searching ${marketType} for: "${inputValue}"`);
                    const data = await searchTickers(inputValue, marketType);
                    console.log(`📊 Search results:`, data);
                    setResults(data);
                    setShowDropdown(true);
                } catch (error) {
                    console.error("❌ Search error:", error);
                    setResults([]);
                } finally {
                    setIsLoading(false);
                }
            } else {
                setResults([]);
                setShowDropdown(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [inputValue, marketType]);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleAdd = (ticker: string) => {
        onAddTicker(ticker.toUpperCase(), marketType);
        setInputValue('');
        setResults([]);
        setShowDropdown(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (inputValue.trim()) {
            handleAdd(inputValue.trim());
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 w-full animate-fade-in">
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Watchlist</h2>
                    <span className="text-sm font-semibold text-slate-400 bg-slate-800 px-2 py-1 rounded">
                        {filteredTickers.length} {filteredTickers.length === 1 ? 'asset' : 'assets'}
                    </span>
                </div>

                {/* Market Type Selector */}
                <div className="flex gap-2 mb-2">
                    <button
                        onClick={() => setMarketType('STOCKS')}
                        className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${marketType === 'STOCKS'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
                            }`}
                    >
                        Stocks
                    </button>
                    <button
                        onClick={() => setMarketType('CRYPTO')}
                        className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${marketType === 'CRYPTO'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300'
                            }`}
                    >
                        Crypto
                    </button>
                </div>

                {/* Sort Toggle */}
                <button
                    onClick={() => setSortOrder(prev => prev === 'ALPHA' ? 'NEWEST' : 'ALPHA')}
                    className="mb-2 w-full flex items-center justify-between px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 transition-colors"
                >
                    <span className="font-semibold">Sort:</span>
                    <span className="flex items-center gap-1">
                        {sortOrder === 'ALPHA' ? 'Alphabetical (A-Z)' : 'Last Added'}
                        <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {sortOrder === 'ALPHA'
                                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            }
                        </svg>
                    </span>
                </button>

                <p className="text-xs text-slate-400">Manage tracked assets</p>
            </div>

            <div className="p-4 border-b border-slate-800 relative z-20">
                <form onSubmit={handleSubmit} className="flex gap-2 relative">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onFocus={() => inputValue.length >= 2 && setShowDropdown(true)}
                            placeholder={marketType === 'CRYPTO' ? "Search (e.g. BTC, ETH, BNB)" : "Search (e.g. Apple, AAPL)"}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                        />
                        {isLoading && (
                            <div className="absolute right-3 top-2.5">
                                <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                            </div>
                        )}
                    </div>
                </form>

                {/* Autocomplete Dropdown */}
                {showDropdown && (results.length > 0 || isLoading) && (
                    <div ref={dropdownRef} className="absolute left-4 right-4 top-14 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 animate-in fade-in zoom-in-95 duration-100">
                        {results.length > 0 ? (
                            results.map((result) => (
                                <div
                                    key={result.ticker}
                                    onClick={() => handleAdd(result.ticker)}
                                    className="px-3 py-2 hover:bg-slate-700 cursor-pointer border-b border-slate-700/50 last:border-0 flex justify-between items-center group"
                                >
                                    <div>
                                        <div className="font-bold text-white group-hover:text-indigo-300 transition-colors">{result.ticker}</div>
                                        <div className="text-xs text-slate-400 truncate max-w-[180px]">{result.name}</div>
                                    </div>
                                    <div className="text-[10px] text-slate-500 uppercase px-1.5 py-0.5 bg-slate-900 rounded border border-slate-700">
                                        {result.market}
                                    </div>
                                </div>
                            ))
                        ) : (
                            !isLoading && <div className="p-3 text-sm text-slate-500 text-center">No results found</div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {filteredTickers.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-500 px-4 text-center opacity-60">
                        <svg className="w-10 h-10 mb-2 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <p className="text-sm">Search above to add assets</p>
                    </div>
                )}

                {filteredTickers
                    .sort((a, b) => {
                        if (sortOrder === 'ALPHA') {
                            return a.ticker.localeCompare(b.ticker);
                        } else {
                            // Newest first
                            return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
                        }
                    })
                    .map((item) => {
                        const ticker = item.ticker;
                        const hasNotes = tickerNotes[ticker] && tickerNotes[ticker].length > 0;
                        const isExpanded = expandedNotesTicker === ticker;
                        const notes = tickerNotes[ticker] || [];
                        // Sort notes from newest to oldest
                        const sortedNotes = [...notes].sort((a, b) =>
                            new Date(b.date).getTime() - new Date(a.date).getTime()
                        );

                        return (
                            <div key={ticker}>
                                <div
                                    onClick={() => onSelectTicker(ticker)}
                                    className={`group flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all duration-200 ${ticker === activeTicker
                                        ? 'bg-gradient-to-r from-indigo-900/50 to-slate-800 border-indigo-500/50 shadow-lg shadow-indigo-500/10 translate-x-1'
                                        : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600 hover:translate-x-0.5'
                                        }`}
                                >
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className={`font-bold text-lg ${ticker === activeTicker ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>
                                                {ticker}
                                            </span>
                                            {item.business_score && (
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold ${parseInt(item.business_score.split('/')[0]) >= 6 ? 'bg-emerald-500/20 text-emerald-400' :
                                                        parseInt(item.business_score.split('/')[0]) >= 4 ? 'bg-yellow-500/20 text-yellow-400' :
                                                            'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {item.business_score}
                                                </span>
                                            )}
                                            {syncingTickers.has(ticker) && (
                                                <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin shadow-[0_0_5px_rgba(99,102,241,0.4)]"></div>
                                            )}
                                        </div>
                                        {openTrades.has(ticker) && (
                                            <span className="text-[8px] font-black bg-emerald-500 text-emerald-950 px-1.5 py-0.5 rounded-sm w-fit mt-0.5 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                                                TRADING
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {hasNotes && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedNotesTicker(isExpanded ? null : ticker);
                                                }}
                                                className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${isExpanded
                                                    ? 'bg-yellow-500/30 text-yellow-300'
                                                    : 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400'
                                                    }`}
                                                title={isExpanded ? 'Hide notes' : 'Show notes'}
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveTicker(ticker);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1.5 rounded-md hover:bg-red-400/10 transition-all transform hover:scale-110"
                                            title="Remove Ticker"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Notes Section */}
                                {isExpanded && sortedNotes.length > 0 && (
                                    <div className="mt-1 mb-2 ml-2 mr-2 p-3 bg-slate-900/80 rounded-lg border border-slate-700/50">
                                        <div className="flex items-center gap-2 mb-2">
                                            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                            </svg>
                                            <h4 className="text-sm font-semibold text-white">Notes History</h4>
                                        </div>
                                        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                                            {sortedNotes.map((noteEntry, index) => (
                                                <div key={index} className="p-2 bg-slate-800/50 rounded text-xs text-slate-300 border border-slate-700/30">
                                                    <p className="whitespace-pre-wrap mb-1">{noteEntry.note}</p>
                                                    <p className="text-[10px] text-slate-500 italic">
                                                        {new Date(noteEntry.date).toLocaleString()}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
};

export default TickerManagementPanel;
