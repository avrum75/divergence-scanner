import React, { useState, useEffect } from 'react';
import { ConsolidatedAlert, SignalType, IndicatorType, Timeframe } from '../types';
import { analyzeAlertWithAI } from '../services/geminiService';
import StarRating from './StarRating';
import ReactMarkdown from 'react-markdown';

interface AlertPanelProps {
  alerts: ConsolidatedAlert[];
  onSelectAlert: (ticker: string) => void;
  loading: boolean;
  onScan: () => void;
  activeTicker?: string;
  tickerRatings?: Record<string, number>; // ticker -> rating (1-5)
  onRatingChange?: (ticker: string, rating: number) => void;
  tickerNotes?: Record<string, { note: string; date: string }[]>; // ticker -> array of notes with dates
  onNotesChange?: (ticker: string, note: string) => void; // Adds a new note entry
  businessScores?: Record<string, string>; // ticker -> score (e.g., "6/7")
  lastScanTime?: number | null;
  // Filter state props
  filter?: FilterType;
  onFilterChange?: (filter: FilterType) => void;
  minDivergences?: number;
  onMinDivergencesChange?: (minDivergences: number) => void;
  sortBy?: 'newest' | 'rating';
  onSortByChange?: (sortBy: 'newest' | 'rating') => void;
  // Backlog props
  backlog?: Set<string>;
  onToggleBacklog?: (ticker: string) => void;
  hideBacklogged?: boolean;
  onHideBackloggedChange?: (hide: boolean) => void;
  // Advanced filters
  showHidden?: 'REGULAR' | 'HIDDEN' | 'BOTH';
  onShowHiddenChange?: (mode: 'REGULAR' | 'HIDDEN' | 'BOTH') => void;
  minStrength?: number;
  onMinStrengthChange?: (strength: number) => void;
  onlyConfirmed?: boolean;
  onOnlyConfirmedChange?: (only: boolean) => void;
  onlyTriple?: boolean;
  onOnlyTripleChange?: (only: boolean) => void;
  hideStale?: boolean;
  onHideStaleChange?: (hide: boolean) => void;
  onlyTrendAligned?: boolean;
  onOnlyTrendAlignedChange?: (only: boolean) => void;
  scanSensitivity?: number;
  onScanSensitivityChange?: (sensitivity: number) => void;
  enabledTimeframes?: Timeframe[];
  onEnabledTimeframesChange?: (timeframes: Timeframe[]) => void;
  showNewArrivals?: boolean;
  onShowNewArrivalsChange?: (show: boolean) => void;
  openTrades?: Set<string>;
  syncingTickers?: Set<string>;
}

type FilterType = 'ALL' | 'BULLISH' | 'BEARISH';

// Get available timeframes dynamically
const AVAILABLE_TIMEFRAMES = Object.values(Timeframe);
const MAX_TIMEFRAMES = AVAILABLE_TIMEFRAMES.length;

const AlertPanel: React.FC<AlertPanelProps> = ({
  alerts,
  onSelectAlert,
  loading,
  onScan,
  activeTicker,
  tickerRatings = {},
  onRatingChange,
  tickerNotes = {},
  onNotesChange,
  businessScores = {},
  lastScanTime,
  filter: propFilter = 'ALL',
  onFilterChange,
  minDivergences: propMinDivergences = 1,
  onMinDivergencesChange,
  sortBy: propSortBy = 'newest',
  onSortByChange,
  backlog = new Set(),
  onToggleBacklog,
  hideBacklogged = false,
  onHideBackloggedChange,
  showHidden = 'BOTH',
  onShowHiddenChange,
  minStrength = 0,
  onMinStrengthChange,
  onlyConfirmed = false,
  onOnlyConfirmedChange,
  onlyTriple = false,
  onOnlyTripleChange,
  hideStale = true,
  onHideStaleChange,
  onlyTrendAligned = false,
  onOnlyTrendAlignedChange,
  scanSensitivity = 3,
  onScanSensitivityChange,
  enabledTimeframes = AVAILABLE_TIMEFRAMES,
  onEnabledTimeframesChange,
  showNewArrivals = false,
  onShowNewArrivalsChange,
  openTrades = new Set(),
  syncingTickers = new Set()
}) => {
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{ id: string, text: string } | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [openNotesTicker, setOpenNotesTicker] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState<string>('');
  const [openBusinessAnalysisTicker, setOpenBusinessAnalysisTicker] = useState<string | null>(null);
  const [businessAnalyses, setBusinessAnalyses] = useState<Record<string, { analysis: string; scorecard: any; markdown: string | null }>>({});
  const [loadingBusinessAnalysis, setLoadingBusinessAnalysis] = useState<Set<string>>(new Set());

  // Auto-update staleness indicator every minute
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const formatStaleness = (lastScan: number | null | undefined): { text: string; color: string } => {
    if (!lastScan) return { text: 'Never scanned', color: 'text-red-400' };
    const elapsed = Date.now() - lastScan;
    const minutes = Math.floor(elapsed / 60000);
    const hours = Math.floor(elapsed / 3600000);
    if (minutes < 1) return { text: 'Scanned just now', color: 'text-emerald-400' };
    if (minutes < 30) return { text: `Scanned ${minutes}m ago`, color: 'text-emerald-400' };
    if (minutes < 120) return { text: `Scanned ${minutes}m ago`, color: 'text-yellow-400' };
    return { text: `Scanned ${hours}h ago`, color: 'text-red-400' };
  };

  // Use props if provided, otherwise use local state (for backward compatibility)
  const filter = propFilter;
  const minDivergences = propMinDivergences;
  const setFilter = (newFilter: FilterType) => {
    if (onFilterChange) {
      onFilterChange(newFilter);
    }
  };

  const setMinDivergences = (newMinDivergences: number) => {
    if (onMinDivergencesChange) {
      onMinDivergencesChange(newMinDivergences);
    }
  };

  const handleAIAnalysis = async (e: React.MouseEvent, alert: ConsolidatedAlert) => {
    e.stopPropagation();
    const alertId = `${alert.ticker}-${Date.now()}`;
    setAnalyzingId(alertId);

    const signal = alert.signals[0];
    const result = await analyzeAlertWithAI({
      id: alertId,
      ticker: alert.ticker,
      timeframe: signal.timeframe,
      signalType: signal.signalType,
      indicator: signal.indicator,
      price: alert.price,
      timestamp: alert.timestamp,
      description: signal.description
    });

    setAnalysisResult({ id: alertId, text: result });
    setAnalyzingId(null);
  };

  const handleNotesClick = (e: React.MouseEvent, ticker: string) => {
    e.stopPropagation();
    const isOpening = openNotesTicker !== ticker;
    setOpenNotesTicker(isOpening ? ticker : null);
    // Clear note text when opening/closing
    if (isOpening) {
      setNewNoteText('');
    }
  };

  const handleNotesSave = (ticker: string) => {
    if (onNotesChange && newNoteText.trim()) {
      onNotesChange(ticker, newNoteText.trim());
      setNewNoteText('');
    }
    setOpenNotesTicker(null);
  };

  const handleNotesCancel = (ticker: string) => {
    setNewNoteText('');
    setOpenNotesTicker(null);
  };

  const parseBusinessAnalysis = (analysis: string) => {
    try {
      let braceCount = 0;
      let jsonStart = -1;
      let jsonEnd = -1;

      for (let i = 0; i < analysis.length; i++) {
        if (analysis[i] === '{') {
          if (jsonStart === -1) {
            jsonStart = i;
          }
          braceCount++;
        } else if (analysis[i] === '}') {
          braceCount--;
          if (braceCount === 0 && jsonStart !== -1) {
            jsonEnd = i;
            break;
          }
        }
      }

      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = analysis.substring(jsonStart, jsonEnd + 1);
        const jsonData = JSON.parse(jsonStr);

        let markdownPart = analysis.substring(jsonEnd + 1).trim();
        markdownPart = markdownPart
          .replace(/^[-]{3,}\s*\n?/m, '')
          .replace(/^##\s*Detailed\s*Analysis\s*\n?/im, '')
          .replace(/^\s*\n\s*\n/gm, '\n')
          .trim();
        markdownPart = markdownPart.replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '');
        markdownPart = markdownPart.replace(/```\s*\{[\s\S]*?\}\s*```/gi, '');

        return { scorecard: jsonData, markdown: markdownPart || null };
      } else {
        return { scorecard: null, markdown: analysis };
      }
    } catch (err) {
      console.error('Error parsing business analysis:', err);
      return { scorecard: null, markdown: analysis };
    }
  };

  const handleBusinessAnalysisClick = async (e: React.MouseEvent, ticker: string) => {
    e.stopPropagation();
    const isOpening = openBusinessAnalysisTicker !== ticker;
    setOpenBusinessAnalysisTicker(isOpening ? ticker : null);

    if (isOpening && !businessAnalyses[ticker]) {
      // Load the analysis
      setLoadingBusinessAnalysis(prev => new Set(prev).add(ticker));
      const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
      const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      
      try {
        const res = await fetch(`${API_URL}/api/good_business/${normalizedTicker}`);
        if (res.ok) {
          const savedAnalysis = await res.json();
          if (savedAnalysis && savedAnalysis.analysis) {
            const parsed = parseBusinessAnalysis(savedAnalysis.analysis);
            setBusinessAnalyses(prev => ({
              ...prev,
              [ticker]: {
                analysis: savedAnalysis.analysis,
                scorecard: parsed.scorecard,
                markdown: parsed.markdown
              }
            }));
          }
        }
      } catch (err) {
        console.error('Error loading business analysis:', err);
      } finally {
        setLoadingBusinessAnalysis(prev => {
          const next = new Set(prev);
          next.delete(ticker);
          return next;
        });
      }
    }
  };

  const filteredAlerts = alerts.filter(alert => {
    // Filter by signal type (BULLISH/BEARISH/ALL)
    if (filter !== 'ALL') {
      const hasBullish = alert.signals.some(s => s.signalType === SignalType.BULLISH_DIVERGENCE || s.signalType === SignalType.BULLISH_HIDDEN);
      const hasBearish = alert.signals.some(s => s.signalType === SignalType.BEARISH_DIVERGENCE || s.signalType === SignalType.BEARISH_HIDDEN);
      const typeMatch = filter === 'BULLISH' ? hasBullish : hasBearish;
      if (!typeMatch) return false;
    }

    // Filter signals within the alert based on showHidden, enabledTimeframes, and quality settings
    const activeSignals = alert.signals.filter(s => {
      if (!enabledTimeframes.includes(s.timeframe)) return false;

      // Divergence Type Filter
      if (showHidden === 'REGULAR' && s.isHidden) return false;
      if (showHidden === 'HIDDEN' && !s.isHidden) return false;

      // Quality Filters
      if (hideStale && s.isStale) return false;
      if (onlyTrendAligned && !s.isTrendAligned) return false;

      return true;
    });

    if (activeSignals.length === 0) return false;

    // Advanced Filters applied only to active signals
    if (onlyConfirmed && !activeSignals.some(s => s.isConfirmed)) return false;
    if (onlyTriple && !activeSignals.some(s => s.isTriple)) return false;
    if (minStrength > 0 && !activeSignals.some(s => (s.strength || 0) >= minStrength)) return false;

    // List only unique timeframes for divergence filter based on active signals
    const uniqueTimeframes = new Set(activeSignals.map(s => s.timeframe));
    if (uniqueTimeframes.size < minDivergences) return false;

    // Filter out backlogged if requested
    if (hideBacklogged && backlog.has(alert.ticker)) return false;

    // Filter by new arrivals (discovered in last trading day)
    if (showNewArrivals) {
      // If no discoveredAt, skip this alert (it's an old alert from before tracking)
      if (!alert.discoveredAt) {
        return false;
      }
      
      const discoveredDate = new Date(alert.discoveredAt);
      const now = new Date();
      
      // Get the start of today in local time
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      
      // Calculate the start of the last trading day
      let lastTradingDay = new Date(today);
      const dayOfWeek = today.getDay();
      
      // If it's Sunday (0), go back to Friday
      if (dayOfWeek === 0) {
        lastTradingDay.setDate(today.getDate() - 2);
      }
      // If it's Saturday (6), go back to Friday
      else if (dayOfWeek === 6) {
        lastTradingDay.setDate(today.getDate() - 1);
      }
      // Otherwise, it's a weekday, so last trading day is today
      // (no change needed)
      
      // Normalize both dates to midnight for comparison
      const discoveredMidnight = new Date(discoveredDate);
      discoveredMidnight.setHours(0, 0, 0, 0);
      
      // Check if discovered on or after the start of last trading day
      // We want to include anything discovered from the start of last trading day until now
      if (discoveredMidnight < lastTradingDay) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    // Sort by user preference
    if (propSortBy === 'rating') {
      // Sort by rating (highest first), then by timestamp
      const ratingA = tickerRatings[a.ticker] || 0;
      const ratingB = tickerRatings[b.ticker] || 0;
      if (ratingB !== ratingA) {
        return ratingB - ratingA; // Higher rating first
      }
      // If ratings are equal, sort by timestamp (newest first)
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    } else {
      // Sort by newest (timestamp) first
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    }
  }).sort((a, b) => {
    // Backlog always goes to the bottom (after main sort)
    const isBacklogA = backlog.has(a.ticker);
    const isBacklogB = backlog.has(b.ticker);
    if (isBacklogA !== isBacklogB) {
      return isBacklogA ? 1 : -1;
    }
    return 0; // Maintain the order from the previous sort
  });

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 w-80">
      <div className="p-4 border-b border-slate-800">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">TradePulse Scanner</h2>
          <button
            onClick={onScan}
            disabled={loading}
            className={`p-2 rounded-full transition-all ${loading ? 'bg-indigo-500/20 text-indigo-400 rotate-180' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
            title="Run Scanner"
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={onScan}
            disabled={loading}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Scanning Market...' : 'Run Scanner'}
          </button>
          <button
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={`px-4 py-2 rounded-lg font-bold transition-colors ${showFilterPanel
              ? 'bg-slate-700 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            title="Filter Settings"
          >
            Filter
          </button>
        </div>

        {lastScanTime !== undefined && (
          <div className={`text-[10px] font-medium mb-3 ${formatStaleness(lastScanTime).color}`}>
            {formatStaleness(lastScanTime).text}
          </div>
        )}

        {showFilterPanel && (
          <div className="mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-semibold text-white mb-3">Divergence Sync</h3>
            <div className="space-y-2 mb-4">
              {Array.from({ length: enabledTimeframes.length }, (_, i) => i + 1).map((num) => (
                <label key={num} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="minDivergences"
                    value={num}
                    checked={minDivergences === num}
                    onChange={() => setMinDivergences(num)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">
                    At least {num} {num === 1 ? 'timeframe' : 'timeframes'}
                  </span>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-700 pt-3">
              <h3 className="text-sm font-semibold text-white mb-3">Sort By</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sortBy"
                    value="newest"
                    checked={propSortBy === 'newest'}
                    onChange={() => onSortByChange && onSortByChange('newest')}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">
                    Newest
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sortBy"
                    value="rating"
                    checked={propSortBy === 'rating'}
                    onChange={() => onSortByChange && onSortByChange('rating')}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">
                    Highest Rating
                  </span>
                </label>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-3">
              <h3 className="text-sm font-semibold text-white mb-3">Filter</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideBacklogged}
                    onChange={(e) => onHideBackloggedChange && onHideBackloggedChange(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">
                    Hide backlogged tickers
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showNewArrivals}
                    onChange={(e) => onShowNewArrivalsChange && onShowNewArrivalsChange(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">
                    New arrivals (last trading day)
                  </span>
                </label>
              </div>
            </div>

            <div className="border-t border-slate-700 mt-3 pt-3">
              <h3 className="text-sm font-semibold text-white mb-3">Scan Configuration</h3>
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-400">Target Timeframes</span>
                    <span className="text-[10px] text-indigo-400 font-bold">{enabledTimeframes.length} Active</span>
                  </div>
                  <div className="flex gap-1 p-0.5 bg-slate-900 rounded-md">
                    {AVAILABLE_TIMEFRAMES.map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          const isSelected = enabledTimeframes.includes(tf);
                          const newTfs = isSelected
                            ? enabledTimeframes.filter(t => t !== tf)
                            : [...enabledTimeframes, tf].sort((a, b) => AVAILABLE_TIMEFRAMES.indexOf(a) - AVAILABLE_TIMEFRAMES.indexOf(b));
                          if (newTfs.length > 0) onEnabledTimeframesChange?.(newTfs);
                        }}
                        className={`flex-1 py-1 px-1 text-[9px] font-bold rounded transition-all ${enabledTimeframes.includes(tf) ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-700 mt-3 pt-3">
              <h3 className="text-sm font-semibold text-white mb-3">Advanced Logic</h3>
              <div className="space-y-3">
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400">Divergence Type</span>
                  <div className="flex gap-1 p-0.5 bg-slate-900 rounded-md">
                    {(['REGULAR', 'BOTH', 'HIDDEN'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => onShowHiddenChange?.(mode)}
                        className={`flex-1 py-1 px-1 text-[9px] font-bold rounded transition-all ${showHidden === mode ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyConfirmed}
                    onChange={(e) => onOnlyConfirmedChange?.(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">Only Confirmed (RSI+MACD)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyTriple}
                    onChange={(e) => onOnlyTripleChange?.(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">Only Triple Divergences</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideStale}
                    onChange={(e) => onHideStaleChange?.(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">Hide Stale Signals ({'>'}10 candles)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyTrendAligned}
                    onChange={(e) => onOnlyTrendAlignedChange?.(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
                  />
                  <span className="text-sm text-slate-300">Trend-Aligned Only (Macro)</span>
                </label>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Min Strength</span>
                    <span>{minStrength}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="10"
                    value={minStrength}
                    onChange={(e) => onMinStrengthChange?.(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Scan Sensitivity</span>
                    <span>{scanSensitivity === 3 ? 'FAST' : 'SLOW'}</span>
                  </div>
                  <div className="flex gap-1 p-0.5 bg-slate-900 rounded-md">
                    <button
                      onClick={() => onScanSensitivityChange?.(3)}
                      className={`flex-1 py-1 px-2 text-[10px] font-bold rounded ${scanSensitivity === 3 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      FAST
                    </button>
                    <button
                      onClick={() => onScanSensitivityChange?.(5)}
                      className={`flex-1 py-1 px-2 text-[10px] font-bold rounded ${scanSensitivity === 5 ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      SLOW
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {(['ALL', 'BULLISH', 'BEARISH'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1 text-xs font-medium rounded transition-colors ${filter === f ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-750'}`}
            >
              {f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {filteredAlerts.length === 0 && !loading && (
          <div className="text-center py-10">
            <p className="text-slate-500 text-sm">No signals found.</p>
          </div>
        )}

        {filteredAlerts.map((alert) => (
          <div
            key={alert.ticker}
            onClick={() => onSelectAlert(alert.ticker)}
            className={`p-3 rounded-lg border cursor-pointer group transition-all relative ${backlog.has(alert.ticker) ? 'opacity-40 grayscale-[0.5]' : ''
              } ${alert.ticker === activeTicker
                ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-500/10'
                : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
          >
            {onToggleBacklog && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBacklog(alert.ticker);
                }}
                className={`absolute -top-2 -right-2 p-1.5 rounded-full border shadow-xl z-10 transition-all ${backlog.has(alert.ticker)
                  ? 'bg-slate-700 border-slate-600 text-slate-300'
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-indigo-400 hover:border-indigo-500/50 opacity-0 group-hover:opacity-100'
                  }`}
                title={backlog.has(alert.ticker) ? "Remove from backlog" : "Move to backlog"}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {backlog.has(alert.ticker) ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7 7m0 0l7-7m-7 7V3" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  )}
                </svg>
              </button>
            )}
            <div className="flex justify-between items-start mb-2">
              <div className="flex flex-col flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lg text-white">{alert.ticker}</span>
                  {businessScores && businessScores[alert.ticker] && (
                    <button
                      onClick={(e) => handleBusinessAnalysisClick(e, alert.ticker)}
                      className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold cursor-pointer hover:opacity-80 transition-opacity ${
                        (() => {
                          const score = businessScores[alert.ticker];
                          if (!score) return '';
                          const [passed, total] = score.split('/').map(Number);
                          if (passed >= 6) return 'bg-emerald-500/20 text-emerald-400';
                          if (passed >= 4) return 'bg-yellow-500/20 text-yellow-400';
                          return 'bg-red-500/20 text-red-400';
                        })()
                      }`}
                      title="Click to view Good Business Analysis"
                    >
                      {businessScores[alert.ticker]}
                      {loadingBusinessAnalysis.has(alert.ticker) && (
                        <span className="ml-1 inline-block w-2 h-2 border border-current border-t-transparent rounded-full animate-spin"></span>
                      )}
                    </button>
                  )}
                  {syncingTickers.has(alert.ticker) && (
                    <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                  )}
                </div>
                {openTrades.has(alert.ticker) && (
                  <span className="text-[9px] font-black bg-emerald-500 text-emerald-950 px-1.5 py-0.5 rounded-sm w-fit mt-1 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                    TRADING
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 justify-end max-w-[120px]">
                {alert.signals.filter(s => {
                  if (!enabledTimeframes.includes(s.timeframe)) return false;

                  // Divergence Type
                  if (showHidden === 'REGULAR' && s.isHidden) return false;
                  if (showHidden === 'HIDDEN' && !s.isHidden) return false;

                  // Quality Filters (Badge Logic)
                  if (hideStale && s.isStale) return false;
                  if (onlyTrendAligned && !s.isTrendAligned) return false;

                  return true;
                }).map((sig, idx) => (
                  <div key={idx} className="flex flex-col items-end gap-1">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sig.signalType === SignalType.BULLISH_DIVERGENCE || sig.signalType === SignalType.BULLISH_HIDDEN
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}
                    >
                      {sig.timeframe}
                    </span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {sig.isHidden && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded font-bold">HIDDEN</span>}
                      {sig.isTriple && <span className="text-[8px] bg-purple-500/20 text-purple-400 px-1 rounded font-bold">TRIPLE</span>}
                      {sig.isConfirmed && <span className="text-[8px] bg-cyan-500/20 text-cyan-400 px-1 rounded font-bold">CONFIRMED</span>}
                      {sig.isMaturing && <span className="text-[8px] bg-orange-500/20 text-orange-400 px-1 rounded font-bold animate-pulse">MATURING</span>}
                      {sig.isStale && <span className="text-[8px] bg-slate-500/20 text-slate-400 px-1 rounded font-bold">STALE</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1 mb-2">
              <p className="text-[11px] text-slate-400 line-clamp-1 italic">
                {(() => {
                  const count = alert.signals.filter(s => {
                    if (!enabledTimeframes.includes(s.timeframe)) return false;

                    // Divergence Type
                    if (showHidden === 'REGULAR' && s.isHidden) return false;
                    if (showHidden === 'HIDDEN' && !s.isHidden) return false;

                    // Quality Filters (Count Logic)
                    if (hideStale && s.isStale) return false;
                    if (onlyTrendAligned && !s.isTrendAligned) return false;

                    return true;
                  }).length;
                  return `${count} signal${count !== 1 ? 's' : ''} detected`;
                })()}
              </p>
              {alert.signals.some(s => s.strength !== undefined) && (
                <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.max(...alert.signals.map(s => s.strength || 0))}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between items-center mt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                {onRatingChange && (
                  <StarRating
                    rating={tickerRatings[alert.ticker] || 0}
                    onRatingChange={(rating) => onRatingChange(alert.ticker, rating)}
                    size="sm"
                  />
                )}
              </div>
              <div className="flex items-center gap-1">
                {onNotesChange && (
                  <button
                    onClick={(e) => handleNotesClick(e, alert.ticker)}
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${tickerNotes[alert.ticker] && tickerNotes[alert.ticker].length > 0
                      ? 'bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-300'
                      : 'bg-slate-600/20 hover:bg-slate-600/40 text-slate-400'
                      }`}
                    title={tickerNotes[alert.ticker] && tickerNotes[alert.ticker].length > 0 ? 'Add note' : 'Add note'}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={(e) => handleAIAnalysis(e, alert)}
                  className="text-xs bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                >
                  {analyzingId && analyzingId.startsWith(alert.ticker) ? (
                    <span className="animate-pulse">Analyzing...</span>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" /></svg>
                      Ask AI
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Notes Input */}
            {openNotesTicker === alert.ticker && (
              <div className="mt-3 p-3 bg-slate-900/80 rounded-lg border border-slate-700/50" onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="Add your notes about this potential trade..."
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  rows={4}
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => handleNotesCancel(alert.ticker)}
                    className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleNotesSave(alert.ticker)}
                    className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
                  >
                    Add Note
                  </button>
                </div>
              </div>
            )}

            {/* Display existing notes with dates */}
            {tickerNotes[alert.ticker] && tickerNotes[alert.ticker].length > 0 && openNotesTicker !== alert.ticker && (
              <div className="mt-2 space-y-2">
                {tickerNotes[alert.ticker].map((noteEntry, index) => (
                  <div key={index} className="p-2 bg-slate-900/50 rounded text-xs text-slate-300 border border-slate-700/50">
                    <div className="flex items-start gap-2">
                      <svg className="w-3 h-3 mt-0.5 text-yellow-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <div className="flex-1">
                        <p className="whitespace-pre-wrap mb-1">{noteEntry.note}</p>
                        <p className="text-[10px] text-slate-500 italic">
                          {new Date(noteEntry.date).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {analysisResult && analysisResult.id.startsWith(alert.ticker) && (
              <div className="mt-3 p-2 bg-slate-900/50 rounded text-xs text-slate-300 border border-slate-700/50 italic">
                {analysisResult.text}
              </div>
            )}

            {/* Good Business Analysis */}
            {businessScores && businessScores[alert.ticker] && (
              <div className="mt-2">
                <button
                  onClick={(e) => handleBusinessAnalysisClick(e, alert.ticker)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={openBusinessAnalysisTicker === alert.ticker ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
                  </svg>
                  Good Business Analysis
                  {loadingBusinessAnalysis.has(alert.ticker) && (
                    <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin ml-1"></div>
                  )}
                </button>

                {openBusinessAnalysisTicker === alert.ticker && businessAnalyses[alert.ticker] && (
                  <div className="mt-2 p-3 bg-slate-900/50 rounded text-xs border border-slate-700/50">
                    {businessAnalyses[alert.ticker].scorecard && (
                      <div className="mb-4 pb-3 border-b border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-white">Good Business Scorecard</h5>
                          <div className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            businessAnalyses[alert.ticker].scorecard.verdict?.is_good_business
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {businessAnalyses[alert.ticker].scorecard.verdict?.score || 'N/A'}
                          </div>
                        </div>
                        {businessAnalyses[alert.ticker].scorecard.verdict?.summary && (
                          <p className="text-[10px] text-slate-300 mb-2">{businessAnalyses[alert.ticker].scorecard.verdict.summary}</p>
                        )}
                        {businessAnalyses[alert.ticker].scorecard.metrics && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {Object.entries(businessAnalyses[alert.ticker].scorecard.metrics).map(([key, metric]: [string, any]) => (
                              <div key={key} className={`p-1.5 rounded text-[10px] ${
                                metric.pass ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
                              }`}>
                                <div className="font-semibold text-white">{key}</div>
                                {metric.reason && (
                                  <div className="text-slate-400 mt-0.5">{metric.reason}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {businessAnalyses[alert.ticker].markdown && (
                      <div className="text-slate-300 text-[10px] prose prose-invert max-w-none">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-2" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                            li: ({ children }) => <li style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</li>,
                            h1: ({ children }) => <h1 className="text-sm font-bold text-white mt-2 mb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-xs font-semibold text-white mt-2 mb-1">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-xs font-semibold text-white mt-1 mb-1">{children}</h3>,
                          }}
                        >
                          {businessAnalyses[alert.ticker].markdown}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertPanel;