import React from 'react';
import { Trade } from '../types';

interface PortfolioPanelProps {
  trades: Trade[];
  onSelectTicker: (ticker: string) => void;
}

const PortfolioPanel: React.FC<PortfolioPanelProps> = ({ trades, onSelectTicker }) => {
  // Safety check: ensure trades is always an array
  const safeTrades = trades || [];
  
  // calculate total PnL
  const totalInvested = safeTrades.reduce((sum, t) => sum + (t.amount || 0), 0);
  // Simulate current value based on the stored random pnlPercent
  const totalValue = safeTrades.reduce((sum, t) => sum + ((t.amount || 0) * (1 + ((t.pnlPercent || 0) / 100))), 0);
  const totalPnL = totalValue - totalInvested;

  return (
    <div className="flex flex-col h-full bg-slate-900 w-full">
      <div className="p-4 border-b border-slate-800">
        <h2 className="text-xl font-bold text-white mb-1">Active Portfolio</h2>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="bg-slate-800 p-2 rounded">
             <div className="text-xs text-slate-400">Invested</div>
             <div className="text-sm font-bold">${totalInvested.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800 p-2 rounded">
             <div className="text-xs text-slate-400">P&L</div>
             <div className={`text-sm font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
               {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
             </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {safeTrades.length === 0 && (
          <div className="text-center text-slate-500 mt-10 px-4">
            <p>No open positions.</p>
            <p className="text-xs mt-2">Open a chart and click "Open Trade" to add positions.</p>
          </div>
        )}

        {safeTrades.map((trade, index) => {
          if (!trade) return null;
          
          const pnl = trade.pnlPercent || 0;
          const isProfit = pnl >= 0;
          const tradeId = trade.id || `trade-${index}`;
          const ticker = trade.ticker || 'N/A';
          const entryPrice = trade.entryPrice || 0;
          const amount = trade.amount || 0;
          const tradeType = trade.type || 'LONG';
          const timestamp = trade.timestamp || new Date().toISOString();

          return (
            <div 
              key={tradeId}
              onClick={() => ticker !== 'N/A' && onSelectTicker(ticker)}
              className="p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 cursor-pointer group transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <span className="font-bold text-lg text-white">{ticker}</span>
                  <span className={`ml-2 text-xs font-bold px-1 py-0.5 rounded ${
                    tradeType === 'LONG' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                  }`}>
                    {tradeType}
                  </span>
                </div>
                <div className={`text-sm font-mono font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                   {isProfit ? '+' : ''}{pnl.toFixed(2)}%
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-400">
                 <span>Entry: <span className="text-slate-200">${entryPrice.toFixed(2)}</span></span>
                 <span className="text-right">Size: <span className="text-slate-200">${amount.toLocaleString()}</span></span>
              </div>
              
              <div className="mt-2 text-[10px] text-slate-500 text-right">
                 {new Date(timestamp).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortfolioPanel;