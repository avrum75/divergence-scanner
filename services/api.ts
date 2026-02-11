
const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

export const api = {
    // Watchlist
    getWatchlist: async () => {
        const res = await fetch(`${API_URL}/api/watchlist`);
        if (!res.ok) throw new Error('Failed to fetch watchlist');
        return res.json();
    },
    addToWatchlist: async (ticker: string, marketType: string) => {
        const res = await fetch(`${API_URL}/api/watchlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, market_type: marketType })
        });
        if (!res.ok) throw new Error('Failed to add to watchlist');
        return res.json();
    },
    removeFromWatchlist: async (ticker: string) => {
        const res = await fetch(`${API_URL}/api/watchlist/${ticker}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to remove from watchlist');
        return res.json();
    },

    // Notes
    getNotes: async (ticker: string) => {
        const res = await fetch(`${API_URL}/api/notes/${ticker}`);
        if (!res.ok) throw new Error('Failed to fetch notes');
        return res.json();
    },
    addNote: async (ticker: string, content: string) => {
        const res = await fetch(`${API_URL}/api/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, content })
        });
        if (!res.ok) throw new Error('Failed to add note');
        return res.json();
    },
    getAllNotes: async () => {
        const res = await fetch(`${API_URL}/api/notes`);
        if (!res.ok) return [];
        return res.json();
    },

    // Ratings
    getRatings: async () => {
        const res = await fetch(`${API_URL}/api/ratings`);
        if (!res.ok) throw new Error('Failed to fetch ratings');
        return res.json();
    },
    setRating: async (ticker: string, rating: number) => {
        const res = await fetch(`${API_URL}/api/ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker, rating })
        });
        if (!res.ok) {
            const errorText = await res.text();
            console.error('Rating API error:', errorText);
            throw new Error(`Failed to set rating: ${errorText}`);
        }
        return res.json();
    },

    // Trades
    getTrades: async () => {
        const res = await fetch(`${API_URL}/api/trades`);
        if (!res.ok) throw new Error('Failed to fetch trades');
        return res.json();
    },
    addTrade: async (trade: any) => {
        const res = await fetch(`${API_URL}/api/trades`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: trade.id,
                ticker: trade.ticker,
                entry_price: trade.entryPrice,
                amount: trade.amount,
                type: trade.type,
                timestamp: trade.timestamp,
                pnl_percent: trade.pnlPercent
            })
        });
        if (!res.ok) throw new Error('Failed to add trade');
        return res.json();
    },

    // Bars
    getBars: async (ticker: string, timeframe: string) => {
        const res = await fetch(`${API_URL}/api/bars/${encodeURIComponent(ticker)}/${timeframe}`);
        if (!res.ok) throw new Error('Failed to fetch bars');
        return res.json();
    },
    createBars: async (bars: any[]) => {
        if (bars.length === 0) return;
        const res = await fetch(`${API_URL}/api/bars/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bars)
        });
        if (!res.ok) throw new Error('Failed to bulk insert bars');
        return res.json();
    },

    // Sync Status
    getSyncStatus: async (id: string) => {
        const res = await fetch(`${API_URL}/api/sync_status/${encodeURIComponent(id)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('Failed to get sync status');
        return res.json();
    },
    updateSyncStatus: async (id: string, lastSync: string) => {
        const res = await fetch(`${API_URL}/api/sync_status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, last_sync: lastSync })
        });
        if (!res.ok) throw new Error('Failed to update sync status');
        return res.json();
    },

    // Backlog
    getBacklog: async () => {
        const res = await fetch(`${API_URL}/api/backlog`);
        if (!res.ok) throw new Error('Failed to fetch backlog');
        return res.json();
    },
    addToBacklog: async (ticker: string) => {
        const res = await fetch(`${API_URL}/api/backlog/${ticker}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Failed to add to backlog');
        return res.json();
    },
    removeFromBacklog: async (ticker: string) => {
        const res = await fetch(`${API_URL}/api/backlog/${ticker}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to remove from backlog');
        return res.json();
    },

    // Good Business Analysis
    getBusinessScores: async (tickers: string[]): Promise<Record<string, string | null>> => {
        if (tickers.length === 0) return {};
        const tickersParam = tickers.join(',');
        const res = await fetch(`${API_URL}/api/good_business/scores?tickers=${encodeURIComponent(tickersParam)}`);
        if (!res.ok) return {};
        return res.json();
    },

    // Scanner Results
    getScannerResults: async () => {
        const res = await fetch(`${API_URL}/api/scanner/results`);
        if (!res.ok) return [];
        return res.json();
    },
    saveScannerResults: async (alerts: any[]) => {
        const res = await fetch(`${API_URL}/api/scanner/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(alerts)
        });
        if (!res.ok) throw new Error('Failed to save scanner results');
        return res.json();
    },

    // Backtesting
    getStrategies: async () => {
        const res = await fetch(`${API_URL}/api/strategies`);
        if (!res.ok) throw new Error('Failed to fetch strategies');
        return res.json();
    },
    getStrategy: async (strategyId: string) => {
        const res = await fetch(`${API_URL}/api/strategies/${encodeURIComponent(strategyId)}`);
        if (!res.ok) throw new Error('Failed to fetch strategy');
        return res.json();
    },
    runBacktest: async (strategyId: string, ticker: string, timeframe: string, paramOverrides?: Record<string, any>) => {
        const res = await fetch(`${API_URL}/api/backtest/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                strategy_id: strategyId,
                ticker,
                timeframe,
                param_overrides: paramOverrides || null,
            })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Backtest failed' }));
            throw new Error(err.detail || 'Backtest failed');
        }
        return res.json();
    },
    getBacktestResults: async (strategyId?: string, ticker?: string) => {
        const params = new URLSearchParams();
        if (strategyId) params.set('strategy_id', strategyId);
        if (ticker) params.set('ticker', ticker);
        const qs = params.toString();
        const res = await fetch(`${API_URL}/api/backtest/results${qs ? '?' + qs : ''}`);
        if (!res.ok) return [];
        return res.json();
    },
    getBacktestResult: async (resultId: number) => {
        const res = await fetch(`${API_URL}/api/backtest/results/${resultId}`);
        if (!res.ok) throw new Error('Failed to fetch backtest result');
        return res.json();
    },
    deleteBacktestResult: async (resultId: number) => {
        const res = await fetch(`${API_URL}/api/backtest/results/${resultId}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete backtest result');
        return res.json();
    },
};
