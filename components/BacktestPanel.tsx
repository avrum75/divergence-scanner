import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Strategy {
  id: string;
  name: string;
  description: string;
  direction: string;
  indicator: string;
  signal_type: string;
  parameters: Record<string, any>;
  has_pine_script: boolean;
}

interface BacktestMetrics {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_pnl_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  max_win_pct: number;
  max_loss_pct: number;
  total_pnl_pct: number;
  profit_factor: number;
  avg_bars_held: number;
  max_drawdown_pct: number;
  expectancy: number;
  take_profit_exits: number;
  stop_loss_exits: number;
  open_exits: number;
}

interface BacktestTrade {
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  pnl_pct: number;
  exit_reason: string;
  bars_held: number;
  signal: { rsi: number; rsi_delta: number; price_delta_pct: number };
}

interface BacktestResult {
  id: number;
  strategy: string;
  strategy_id: string;
  direction: string;
  ticker: string;
  timeframe: string;
  parameters: Record<string, any>;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  signals_found: number;
  bar_count: number;
  date_range: { start: string; end: string };
  created_at?: string;
}

interface SavedResult {
  id: number;
  strategy_id: string;
  strategy_name: string;
  ticker: string;
  timeframe: string;
  metrics: BacktestMetrics;
  signals_found: number;
  date_range: { start: string; end: string };
  created_at: string;
}

interface BacktestPanelProps {
  tickers: string[];
  activeTicker?: string | null;
}

const PARAM_LABELS: Record<string, string> = {
  rsi_period: 'RSI Period',
  pivot_lookback: 'Pivot Lookback',
  min_rsi_delta: 'Min RSI Delta',
  min_price_delta_pct: 'Min Price Delta %',
  take_profit_pct: 'Take Profit %',
  stop_loss_pct: 'Stop Loss %',
  rsi_zone_max: 'RSI Zone Max',
  rsi_zone_min: 'RSI Zone Min',
  min_pivot_spacing: 'Min Pivot Spacing',
  max_pivot_age: 'Max Pivot Age',
};

const BacktestPanel: React.FC<BacktestPanelProps> = ({ tickers, activeTicker }) => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [ticker, setTicker] = useState(activeTicker || '');
  const [timeframe, setTimeframe] = useState('1D');
  const [paramOverrides, setParamOverrides] = useState<Record<string, any>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [showPineScript, setShowPineScript] = useState(false);
  const [pineScript, setPineScript] = useState<string | null>(null);
  const [view, setView] = useState<'setup' | 'result' | 'history'>('setup');
  const [showParams, setShowParams] = useState(false);

  // Load strategies on mount
  useEffect(() => {
    api.getStrategies().then(s => {
      setStrategies(s);
      if (s.length > 0 && !selectedStrategy) setSelectedStrategy(s[0].id);
    }).catch(() => {});

    api.getBacktestResults().then(setSavedResults).catch(() => {});
  }, []);

  // Update ticker when activeTicker changes
  useEffect(() => {
    if (activeTicker) setTicker(activeTicker);
  }, [activeTicker]);

  const currentStrategy = strategies.find(s => s.id === selectedStrategy);
  const defaultParams = currentStrategy?.parameters || {};

  const handleRun = async () => {
    if (!selectedStrategy || !ticker) return;
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const overrides = Object.keys(paramOverrides).length > 0 ? paramOverrides : undefined;
      const res = await api.runBacktest(selectedStrategy, ticker, timeframe, overrides);
      setResult(res);
      setView('result');
      // Refresh saved results
      api.getBacktestResults().then(setSavedResults).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const handleViewSaved = async (savedId: number) => {
    try {
      const res = await api.getBacktestResult(savedId);
      setResult(res);
      setView('result');
    } catch {
      setError('Failed to load result');
    }
  };

  const handleDeleteSaved = async (id: number) => {
    try {
      await api.deleteBacktestResult(id);
      setSavedResults(prev => prev.filter(r => r.id !== id));
      if (result?.id === id) {
        setResult(null);
        setView('setup');
      }
    } catch {}
  };

  const handleViewPineScript = async () => {
    if (!selectedStrategy) return;
    try {
      const data = await api.getStrategy(selectedStrategy);
      setPineScript(data.pine_script);
      setShowPineScript(true);
    } catch {
      setPineScript(null);
    }
  };

  const handleParamChange = (key: string, value: string) => {
    const numVal = parseFloat(value);
    if (!isNaN(numVal)) {
      setParamOverrides(prev => ({ ...prev, [key]: numVal }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 w-full">
      {/* Header with tabs */}
      <div className="p-3 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white mb-2">Backtesting</h2>
        <div className="flex gap-1">
          {(['setup', 'result', 'history'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${
                view === v
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {v === 'setup' ? 'Setup' : v === 'result' ? 'Result' : 'History'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* SETUP VIEW */}
        {view === 'setup' && (
          <div className="p-3 space-y-3">
            {/* Strategy selector */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Strategy</label>
              <select
                value={selectedStrategy}
                onChange={e => {
                  setSelectedStrategy(e.target.value);
                  setParamOverrides({});
                }}
                className="w-full mt-1 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
              >
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {currentStrategy && (
                <p className="text-[10px] text-slate-500 mt-1">{currentStrategy.description}</p>
              )}
            </div>

            {/* Ticker + Timeframe */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ticker</label>
                <select
                  value={ticker}
                  onChange={e => setTicker(e.target.value)}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select...</option>
                  {tickers.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                >
                  <option value="1H">1H</option>
                  <option value="4H">4H</option>
                  <option value="1D">1D</option>
                </select>
              </div>
            </div>

            {/* Parameters (collapsible) */}
            <div>
              <button
                onClick={() => setShowParams(!showParams)}
                className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-300"
              >
                <svg className={`w-3 h-3 transition-transform ${showParams ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Parameters
              </button>
              {showParams && currentStrategy && (
                <div className="mt-2 space-y-2 bg-slate-800/50 rounded-lg p-2">
                  {Object.entries(defaultParams).map(([key, defaultVal]) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <label className="text-[10px] text-slate-400 whitespace-nowrap">{PARAM_LABELS[key] || key}</label>
                      <input
                        type="number"
                        step="any"
                        defaultValue={defaultVal as number}
                        onChange={e => handleParamChange(key, e.target.value)}
                        className="w-20 bg-slate-700 border border-slate-600 text-white text-[11px] rounded px-2 py-1 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              <button
                onClick={handleRun}
                disabled={running || !ticker || !selectedStrategy}
                className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all ${
                  running
                    ? 'bg-slate-700 text-slate-400 cursor-wait'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                }`}
              >
                {running ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running Backtest...
                  </span>
                ) : 'Run Backtest'}
              </button>

              {currentStrategy?.has_pine_script && (
                <button
                  onClick={handleViewPineScript}
                  className="w-full py-2 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-colors"
                >
                  View Pine Script (TradingView)
                </button>
              )}
            </div>

            {error && (
              <div className="p-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>
            )}
          </div>
        )}

        {/* RESULT VIEW */}
        {view === 'result' && result && (
          <div className="p-3 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">{result.strategy}</h3>
                <p className="text-[10px] text-slate-400">{result.ticker} / {result.timeframe} ({result.bar_count} bars)</p>
                <p className="text-[10px] text-slate-500">
                  {result.date_range.start.split('T')[0]} to {result.date_range.end.split('T')[0]}
                </p>
              </div>
              <div className={`text-lg font-bold font-mono ${result.metrics.total_pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {result.metrics.total_pnl_pct >= 0 ? '+' : ''}{result.metrics.total_pnl_pct.toFixed(1)}%
              </div>
            </div>

            {/* Key metrics grid */}
            <div className="grid grid-cols-3 gap-1.5">
              <MetricCard label="Win Rate" value={`${result.metrics.win_rate}%`} color={result.metrics.win_rate >= 50 ? 'green' : 'red'} />
              <MetricCard label="Trades" value={result.metrics.total_trades.toString()} />
              <MetricCard label="Profit Factor" value={result.metrics.profit_factor.toFixed(2)} color={result.metrics.profit_factor >= 1 ? 'green' : 'red'} />
              <MetricCard label="Avg Win" value={`+${result.metrics.avg_win_pct.toFixed(1)}%`} color="green" />
              <MetricCard label="Avg Loss" value={`${result.metrics.avg_loss_pct.toFixed(1)}%`} color="red" />
              <MetricCard label="Expectancy" value={`${result.metrics.expectancy >= 0 ? '+' : ''}${result.metrics.expectancy.toFixed(2)}%`} color={result.metrics.expectancy >= 0 ? 'green' : 'red'} />
              <MetricCard label="Max Drawdown" value={`-${result.metrics.max_drawdown_pct.toFixed(1)}%`} color="red" />
              <MetricCard label="Avg Bars Held" value={result.metrics.avg_bars_held.toString()} />
              <MetricCard label="Signals" value={result.signals_found.toString()} />
            </div>

            {/* Exit breakdown */}
            <div className="bg-slate-800/50 rounded-lg p-2">
              <p className="text-[10px] font-bold text-slate-400 mb-1">Exit Breakdown</p>
              <div className="flex gap-3 text-[10px]">
                <span className="text-green-400">TP: {result.metrics.take_profit_exits}</span>
                <span className="text-red-400">SL: {result.metrics.stop_loss_exits}</span>
                {result.metrics.open_exits > 0 && <span className="text-yellow-400">Open: {result.metrics.open_exits}</span>}
              </div>
            </div>

            {/* Configuration used */}
            <div className="bg-slate-800/50 rounded-lg p-2">
              <p className="text-[10px] font-bold text-slate-400 mb-1">Configuration</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(result.parameters).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[10px]">
                    <span className="text-slate-500">{PARAM_LABELS[k] || k}</span>
                    <span className="text-slate-300 font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Trade list */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 mb-1">Trades ({result.trades.length})</p>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {result.trades.map((trade, i) => (
                  <div key={i} className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] ${
                    trade.exit_reason === 'OPEN' ? 'bg-yellow-900/20 border border-yellow-800/30' :
                    trade.pnl_pct >= 0 ? 'bg-green-900/20 border border-green-800/30' : 'bg-red-900/20 border border-red-800/30'
                  }`}>
                    <div className="flex flex-col">
                      <span className="text-slate-300 font-mono">{trade.entry_time.split('T')[0]}</span>
                      <span className="text-slate-500">{trade.entry_price.toFixed(2)} &rarr; {trade.exit_price.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={`font-bold font-mono ${trade.pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(2)}%
                      </span>
                      <span className={`text-[9px] ${
                        trade.exit_reason === 'TAKE_PROFIT' ? 'text-green-500' :
                        trade.exit_reason === 'STOP_LOSS' ? 'text-red-500' : 'text-yellow-500'
                      }`}>
                        {trade.exit_reason === 'TAKE_PROFIT' ? 'TP' : trade.exit_reason === 'STOP_LOSS' ? 'SL' : 'OPEN'}
                        {' / '}{trade.bars_held}b
                      </span>
                    </div>
                  </div>
                ))}
                {result.trades.length === 0 && (
                  <p className="text-center text-slate-500 text-[10px] py-4">No trades generated. Try adjusting parameters.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'result' && !result && (
          <div className="p-6 text-center text-slate-500 text-xs">
            No result yet. Run a backtest first.
          </div>
        )}

        {/* HISTORY VIEW */}
        {view === 'history' && (
          <div className="p-3 space-y-2">
            {savedResults.length === 0 ? (
              <p className="text-center text-slate-500 text-xs mt-10">No saved backtests yet.</p>
            ) : (
              savedResults.map(r => (
                <div
                  key={r.id}
                  className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 cursor-pointer transition-colors group"
                >
                  <div className="flex justify-between items-start" onClick={() => handleViewSaved(r.id)}>
                    <div>
                      <p className="text-xs font-bold text-white">{r.strategy_name}</p>
                      <p className="text-[10px] text-slate-400">{r.ticker} / {r.timeframe}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`text-sm font-bold font-mono ${r.metrics.total_pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {r.metrics.total_pnl_pct >= 0 ? '+' : ''}{r.metrics.total_pnl_pct.toFixed(1)}%
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSaved(r.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-slate-500" onClick={() => handleViewSaved(r.id)}>
                    <span>WR: <span className={r.metrics.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}>{r.metrics.win_rate}%</span></span>
                    <span>Trades: {r.metrics.total_trades}</span>
                    <span>PF: {r.metrics.profit_factor.toFixed(1)}</span>
                  </div>
                  {r.created_at && (
                    <p className="text-[9px] text-slate-600 mt-1" onClick={() => handleViewSaved(r.id)}>
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Pine Script Modal */}
      {showPineScript && pineScript && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowPineScript(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Pine Script - {currentStrategy?.name}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(pineScript); }}
                  className="px-3 py-1 text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => setShowPineScript(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-3 text-[11px] text-green-300 font-mono bg-slate-950 leading-relaxed">
              {pineScript}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; color?: 'green' | 'red' }> = ({ label, value, color }) => (
  <div className="bg-slate-800 rounded-lg p-1.5">
    <div className="text-[9px] text-slate-500">{label}</div>
    <div className={`text-xs font-bold font-mono ${
      color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white'
    }`}>{value}</div>
  </div>
);

export default BacktestPanel;
