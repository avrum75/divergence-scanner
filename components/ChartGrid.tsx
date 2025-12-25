import React, { useRef, useEffect } from 'react';
import { IChartApi, LogicalRange } from 'lightweight-charts';
import { TickerData, Timeframe, IndicatorType } from '../types';
import TradingViewChart from './TradingViewChart';

interface ChartGridProps {
  tickerData: TickerData | null;
  loading: boolean;
  onOpenTrade: (ticker: string, price: number) => void;
  onRefresh: () => void;
}

const ChartGrid: React.FC<ChartGridProps> = ({ tickerData, loading, onOpenTrade, onRefresh }) => {
  // Store chart instances grouped by timeframe to synchronize them
  const chartGroups = useRef<Record<string, IChartApi[]>>({});

  // Track synchronization state to prevent infinite loops
  const chartSyncRef = useRef(false);

  // Clear refs when data changes to prevent memory leaks/stale references
  useEffect(() => {
    chartGroups.current = {};
  }, [tickerData?.symbol]);

  const registerChart = (tf: Timeframe, chart: IChartApi) => {
    if (!chartGroups.current[tf]) {
      chartGroups.current[tf] = [];
    }

    // Add chart if not already registered
    const group = chartGroups.current[tf];
    if (!group.includes(chart)) {
      group.push(chart);

      // Setup synchronization
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (chartSyncRef.current || !range) return;

        chartSyncRef.current = true;

        // Sync all other charts in this timeframe group
        group.forEach(otherChart => {
          if (otherChart !== chart) {
            // Check if other chart is still valid (not removed from DOM) - though cleanup should handle this
            try {
              otherChart.timeScale().setVisibleLogicalRange(range as LogicalRange);
            } catch (e) {
              // Ignore if chart is disposed
            }
          }
        });

        chartSyncRef.current = false;
      });
    }

    // Return cleanup function to be called when chart is destroyed
    return () => {
      if (chartGroups.current[tf]) {
        chartGroups.current[tf] = chartGroups.current[tf].filter(c => c !== chart);
      }
    };
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">Loading Market Data...</div>;
  }

  if (!tickerData) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">Select a ticker from the scanner to view charts.</div>;
  }

  // Detect if any timeframe is out of sync
  const isSyncing = tickerData.syncStatus && Object.values(tickerData.syncStatus).some(status => !status);

  // Header price should be the livePrice if synced, otherwise use the H1 close but mark it as syncing
  const displayPrice = tickerData.livePrice || 0;

  const handleTradeClick = () => {
    onOpenTrade(tickerData.symbol, displayPrice);
  };

  const renderChartPane = (tf: Timeframe, label: string) => {
    const data = tickerData.data[tf];
    if (!data) return null;

    // Check if data is stale (> 24 hours old)
    const now = Date.now();
    const lastBar = data.length > 0 ? data[data.length - 1] : null;
    const lastBarTime = lastBar ? new Date(lastBar.time).getTime() : 0;
    const isOutOfSync = !lastBar || (now - lastBarTime > 86400000); // 24 hours

    return (
      <div className={`flex flex-col h-full bg-slate-900 border rounded-lg overflow-hidden transition-all relative ${isOutOfSync ? 'border-amber-500/50' : 'border-slate-800'}`}>
        <div className={`px-4 py-2 border-b flex justify-between items-center ${isOutOfSync ? 'bg-amber-500/10 border-amber-500/20' : 'bg-slate-800/50 border-slate-800'}`}>
          <span className={`font-bold text-sm ${isOutOfSync ? 'text-amber-400' : 'text-slate-200'}`}>
            {label} ({tf})
          </span>
          {isOutOfSync && (
            <span className="text-[10px] font-bold bg-amber-500 text-slate-950 px-1.5 rounded animate-pulse">
              SYNCING...
            </span>
          )}
        </div>

        {/* Loading Overlay */}
        {isOutOfSync && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
              <div className="text-amber-400 text-base font-semibold">Syncing {label}...</div>
              <div className="text-slate-400 text-sm text-center max-w-xs">
                Downloading historical data
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
          {/* Main Price Chart */}
          <div className="flex-[2] min-h-0">
            <TradingViewChart
              data={data}
              type="PRICE"
              onChartReady={(chart) => registerChart(tf, chart)}
            />
          </div>

          {/* Indicators */}
          <div className="flex-1 border-t border-slate-800 min-h-0">
            <TradingViewChart
              data={data}
              type={IndicatorType.RSI}
              onChartReady={(chart) => registerChart(tf, chart)}
            />
          </div>

          {/* Separator - distinct buffer */}
          <div className="h-4 bg-slate-900 border-y-2 border-slate-700/50 flex-none opacity-80"></div>

          <div className="flex-1 min-h-0">
            <TradingViewChart
              data={data}
              type={IndicatorType.MACD}
              onChartReady={(chart) => registerChart(tf, chart)}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-4 bg-slate-950 overflow-hidden flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          {tickerData.symbol}
          <button
            onClick={onRefresh}
            className="p-1 hover:bg-slate-800 rounded transition-colors"
            title="Force refresh data"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <span className="text-slate-500 font-normal text-lg">Multi-Timeframe Analysis</span>
          <span className={`ml-4 text-xl font-mono ${isSyncing ? 'text-amber-400' : 'text-indigo-400'}`}>
            ${displayPrice.toFixed(2)}
          </span>
          {isSyncing && (
            <span className="ml-3 text-[10px] font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30 px-2 py-0.5 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
              DATA ALIGNING...
            </span>
          )}
        </h1>

        <button
          onClick={handleTradeClick}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Open Trade
        </button>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
        {renderChartPane(Timeframe.D1, 'Daily')}
        {renderChartPane(Timeframe.H4, '4 Hour')}
        {renderChartPane(Timeframe.H1, '1 Hour')}
      </div>
    </div>
  );
};

export default ChartGrid;