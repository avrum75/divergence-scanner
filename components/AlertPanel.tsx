import React, { useState } from 'react';
import { ConsolidatedAlert, SignalType, IndicatorType, Timeframe } from '../types';
import { analyzeAlertWithAI } from '../services/geminiService';

interface AlertPanelProps {
  alerts: ConsolidatedAlert[];
  onSelectAlert: (ticker: string) => void;
  loading: boolean;
  onScan: () => void;
  activeTicker?: string;
}

type FilterType = 'ALL' | 'BULLISH' | 'BEARISH';

const AlertPanel: React.FC<AlertPanelProps> = ({ alerts, onSelectAlert, loading, onScan, activeTicker }) => {
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{ id: string, text: string } | null>(null);
  const [filter, setFilter] = useState<FilterType>('ALL');

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

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'ALL') return true;
    const hasBullish = alert.signals.some(s => s.signalType === SignalType.BULLISH_DIVERGENCE);
    const hasBearish = alert.signals.some(s => s.signalType === SignalType.BEARISH_DIVERGENCE);
    return filter === 'BULLISH' ? hasBullish : hasBearish;
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

        <button
          onClick={onScan}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Scanning Market...' : 'Run Scanner'}
        </button>

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
            className={`p-3 rounded-lg border cursor-pointer group transition-all ${alert.ticker === activeTicker
              ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-500/10'
              : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="font-bold text-lg text-white">{alert.ticker}</span>
              <div className="flex flex-wrap gap-1 justify-end max-w-[120px]">
                {alert.signals.map((sig, idx) => (
                  <span
                    key={idx}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sig.signalType === SignalType.BULLISH_DIVERGENCE
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}
                  >
                    {sig.timeframe}
                  </span>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mb-2 line-clamp-1 italic">
              {alert.signals.length} signal{alert.signals.length > 1 ? 's' : ''} detected
            </p>

            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</span>
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

            {analysisResult && analysisResult.id.startsWith(alert.ticker) && (
              <div className="mt-3 p-2 bg-slate-900/50 rounded text-xs text-slate-300 border border-slate-700/50 italic">
                {analysisResult.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertPanel;