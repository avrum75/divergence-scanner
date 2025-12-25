import React, { useState, useEffect, useCallback } from 'react';
import AlertPanel from './components/AlertPanel';
import PortfolioPanel from './components/PortfolioPanel';
import TickerManagementPanel from './components/TickerManagementPanel';
import ChartGrid from './components/ChartGrid';
import { scanMarket, fetchTickerData, getCachedTickerData } from './services/dataService';
import { Alert, TickerData, Trade, Timeframe, ConsolidatedAlert } from './types';
import { TICKERS as INITIAL_TICKERS } from './constants';
import { db } from './db';

type SidebarView = 'SCANNER' | 'PORTFOLIO' | 'WATCHLIST';

function App() {
  const [alerts, setAlerts] = useState<ConsolidatedAlert[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerData, setTickerData] = useState<TickerData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [trackedTickers, setTrackedTickers] = useState<string[]>(INITIAL_TICKERS);
  const [scannedStockRatings, setScannedStockRatings] = useState<Record<string, number>>({});
  const [scannedStockNotes, setScannedStockNotes] = useState<Record<string, { note: string; date: string }[]>>({});

  // Portfolio State
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>('SCANNER');

  const handleScan = useCallback(async (autoSelect: boolean = false) => {
    setScanning(true);
    try {
      const results = await scanMarket(trackedTickers);
      setAlerts(results);
      // Auto-select only if explicitly requested (e.g. on first load)
      if (autoSelect && results.length > 0 && !selectedTicker) {
        handleSelectTicker(results[0].ticker);
      }
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setScanning(false);

      // PHASE 3: Background Refresh (Silent)
      // DISABLED: This causes 429 loops and blocks the UI. 
      // User must click tickers to refresh them, or we implement a smarter queue later.
      /*
      (async () => {
        console.log("Starting background refresh for all tickers...");
        for (const ticker of trackedTickers) {
          try {
            await fetchTickerData(ticker, false, 'LOW');
          } catch (e) {
            console.warn(`Background sync failed for ${ticker}`, e);
          }
        }
        console.log("Background refresh complete.");
      })();
      */
    }
  }, [trackedTickers]);

  // Load data from DB on mount
  useEffect(() => {
    const initDB = async () => {
      const savedTrades = await db.trades.toArray();
      setTrades(savedTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

      const savedWatchlist = await db.watchlist.toArray();
      if (savedWatchlist.length > 0) {
        setTrackedTickers(savedWatchlist.map(w => w.ticker));
      } else {
        // First run: save initial tickers to DB
        const records = INITIAL_TICKERS.map(ticker => ({ ticker, addedAt: new Date().toISOString() }));
        await db.watchlist.bulkAdd(records);
        setTrackedTickers(INITIAL_TICKERS);
      }

      // Load ratings for scanned stocks
      const savedRatings = await db.ratings.toArray();
      const ratings: Record<string, number> = {};
      savedRatings.forEach(r => {
        ratings[r.ticker] = r.rating;
      });
      setScannedStockRatings(ratings);

      // Load notes for scanned stocks
      const savedNotes = await db.notes.toArray();
      const notes: Record<string, { note: string; date: string }[]> = {};
      savedNotes.forEach(n => {
        // Handle migration: if notes is a string (old format), convert to array
        if (typeof n.notes === 'string') {
          notes[n.ticker] = [{ note: n.notes, date: n.updatedAt || new Date().toISOString() }];
        } else if (Array.isArray(n.notes)) {
          notes[n.ticker] = n.notes;
        }
      });
      setScannedStockNotes(notes);
    };
    initDB();
  }, []);

  // Initial Scan - now depends on trackedTickers
  useEffect(() => {
    if (trackedTickers.length > 0) {
      handleScan(true); // Pass true to auto-select on first load
    }
  }, [trackedTickers, handleScan]);

  const handleSelectTicker = async (ticker: string, force: boolean = false) => {
    setSelectedTicker(ticker);
    setLoadingData(true);

    try {
      // Get cached data first
      const cached = await getCachedTickerData(ticker);

      // Show cached data immediately and stop loading
      setTickerData(cached);
      setLoadingData(false);

      // Background sync - don't await, let it run async
      fetchTickerData(ticker, force, 'HIGH').then(freshData => {
        // Only update if user is still viewing this ticker
        setSelectedTicker(current => {
          if (current === ticker) {
            setTickerData(freshData);
          }
          return current;
        });
      }).catch(e => {
        console.error("Background sync failed:", e);
      });
    } catch (e) {
      console.error("Failed to load ticker:", e);
      setLoadingData(false);
    }
  };

  const handleAddTicker = async (ticker: string) => {
    if (!trackedTickers.includes(ticker)) {
      setTrackedTickers(prev => [...prev, ticker]);
      // Check if record exists to preserve rating
      const existing = await db.watchlist.get(ticker);
      if (!existing) {
        await db.watchlist.put({ ticker, addedAt: new Date().toISOString() });
      }
    }
  };

  const handleRemoveTicker = async (ticker: string) => {
    setTrackedTickers(prev => prev.filter(t => t !== ticker));
    await db.watchlist.delete(ticker);
  };

  const handleRatingChange = async (ticker: string, rating: number) => {
    setScannedStockRatings(prev => ({ ...prev, [ticker]: rating }));
    // Update in ratings table
    await db.ratings.put({ ticker, rating });
  };

  const handleNotesChange = async (ticker: string, note: string) => {
    if (!note.trim()) return; // Don't save empty notes
    
    const newNoteEntry = {
      note: note.trim(),
      date: new Date().toISOString()
    };

    setScannedStockNotes(prev => {
      const existingNotes = prev[ticker] || [];
      return {
        ...prev,
        [ticker]: [...existingNotes, newNoteEntry]
      };
    });

    // Update in notes table - append to existing notes array
    const existingRecord = await db.notes.get(ticker);
    if (existingRecord) {
      const existingNotes = Array.isArray(existingRecord.notes) 
        ? existingRecord.notes 
        : typeof existingRecord.notes === 'string' 
          ? [{ note: existingRecord.notes, date: existingRecord.updatedAt || new Date().toISOString() }]
          : [];
      await db.notes.put({
        ticker,
        notes: [...existingNotes, newNoteEntry],
        updatedAt: new Date().toISOString()
      });
    } else {
      // Create new record
      await db.notes.put({
        ticker,
        notes: [newNoteEntry],
        updatedAt: new Date().toISOString()
      });
    }
  };

  const handleOpenTrade = (ticker: string, price: number) => {
    const amountStr = window.prompt(`Enter investment amount for ${ticker}:`, "1000");
    if (!amountStr) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("Invalid amount");
      return;
    }

    // Determine type (simple logic for demo: if mostly green alert, LONG, else assume LONG default)
    // Ideally user selects. We will default to LONG.

    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      ticker,
      entryPrice: price,
      amount,
      type: 'LONG',
      timestamp: new Date().toISOString(),
      // Simulate a random PnL start between -1% and +1% to make the table look alive immediately
      pnlPercent: (Math.random() * 2 - 1)
    };

    setTrades(prev => [newTrade, ...prev]);
    db.trades.add(newTrade);
    setSidebarView('PORTFOLIO'); // Switch to portfolio view to see the new trade
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans">
      {/* Sidebar Container */}
      <div className="flex flex-col h-full w-80 flex-shrink-0 border-r border-slate-800 bg-slate-900">
        {/* Sidebar Tabs */}
        <div className="flex border-b border-slate-800">
          <button
            className={`flex-1 py-3 text-[10px] font-bold transition-colors ${sidebarView === 'SCANNER' ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
            onClick={() => setSidebarView('SCANNER')}
          >
            Scanner
          </button>
          <button
            className={`flex-1 py-3 text-[10px] font-bold transition-colors ${sidebarView === 'WATCHLIST' ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
            onClick={() => setSidebarView('WATCHLIST')}
          >
            Watchlist
          </button>
          <button
            className={`flex-1 py-3 text-[10px] font-bold transition-colors ${sidebarView === 'PORTFOLIO' ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
            onClick={() => setSidebarView('PORTFOLIO')}
          >
            Portfolio ({trades.length})
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-hidden relative">
          {sidebarView === 'SCANNER' ? (
            <AlertPanel
              alerts={alerts}
              onSelectAlert={handleSelectTicker}
              loading={scanning}
              onScan={handleScan}
              activeTicker={selectedTicker || undefined}
              tickerRatings={scannedStockRatings}
              onRatingChange={handleRatingChange}
              tickerNotes={scannedStockNotes}
              onNotesChange={handleNotesChange}
            />
          ) : sidebarView === 'WATCHLIST' ? (
            <TickerManagementPanel
              tickers={trackedTickers}
              onAddTicker={handleAddTicker}
              onRemoveTicker={handleRemoveTicker}
              onSelectTicker={handleSelectTicker}
              activeTicker={selectedTicker}
              tickerNotes={scannedStockNotes}
            />
          ) : (
            <PortfolioPanel
              trades={trades}
              onSelectTicker={handleSelectTicker}
            />
          )}
        </div>
      </div>

      {/* Main Content */}
      <ChartGrid
        tickerData={tickerData}
        loading={loadingData}
        onOpenTrade={handleOpenTrade}
        onRefresh={() => selectedTicker && handleSelectTicker(selectedTicker, true)}
      />
    </div>
  );
}

export default App;