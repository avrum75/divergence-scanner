import React, { useState, useEffect, useCallback } from 'react';
import AlertPanel from './components/AlertPanel';
import PortfolioPanel from './components/PortfolioPanel';
import TickerManagementPanel from './components/TickerManagementPanel';
import ChartGrid from './components/ChartGrid';
import DocumentationModal from './components/DocumentationModal';
import { scanMarket, fetchTickerData, getCachedTickerData, subscribeToSyncs } from './services/dataService';
import { Alert, TickerData, Trade, Timeframe, ConsolidatedAlert } from './types';
import { TICKERS as INITIAL_TICKERS } from './constants';
import { db } from './db';

type SidebarView = 'SCANNER' | 'PORTFOLIO' | 'WATCHLIST';

function App() {
  const [alerts, setAlerts] = useState<ConsolidatedAlert[]>([]);
  const lastScanId = React.useRef(0);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerData, setTickerData] = useState<TickerData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [trackedTickers, setTrackedTickers] = useState<string[]>(INITIAL_TICKERS);
  const [scannedStockRatings, setScannedStockRatings] = useState<Record<string, number>>({});
  const [scannedStockNotes, setScannedStockNotes] = useState<Record<string, { note: string; date: string }[]>>({});
  const [backlog, setBacklog] = useState<Set<string>>(new Set());
  const [syncingTickers, setSyncingTickers] = useState<Set<string>>(new Set());
  const [hideBacklogged, setHideBacklogged] = useState<boolean>(() => {
    const saved = localStorage.getItem('scannerHideBacklogged');
    return saved === 'true';
  });

  // Filter State (persisted in localStorage)
  const [filter, setFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH'>(() => {
    const saved = localStorage.getItem('scannerFilter');
    return (saved as 'ALL' | 'BULLISH' | 'BEARISH') || 'ALL';
  });
  const [minDivergences, setMinDivergences] = useState<number>(() => {
    const saved = localStorage.getItem('scannerMinDivergences');
    return saved ? parseInt(saved, 10) : 1;
  });
  const [sortByRating, setSortByRating] = useState<boolean>(() => {
    const saved = localStorage.getItem('scannerSortByRating');
    return saved === 'true';
  });

  const [divergenceType, setDivergenceType] = useState<'REGULAR' | 'HIDDEN' | 'BOTH'>(() => {
    const saved = localStorage.getItem('scannerDivergenceType');
    return (saved as 'REGULAR' | 'HIDDEN' | 'BOTH') || 'BOTH';
  });
  const [minStrength, setMinStrength] = useState<number>(() => {
    const saved = localStorage.getItem('scannerMinStrength');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [onlyConfirmed, setOnlyConfirmed] = useState<boolean>(() => {
    const saved = localStorage.getItem('scannerOnlyConfirmed');
    return saved === 'true';
  });
  const [onlyTriple, setOnlyTriple] = useState<boolean>(() => localStorage.getItem('scannerOnlyTriple') === 'true');
  const [hideStale, setHideStale] = useState<boolean>(() => localStorage.getItem('scannerHideStale') !== 'false'); // Default TRUE
  const [onlyTrendAligned, setOnlyTrendAligned] = useState<boolean>(() => localStorage.getItem('scannerTrendAligned') === 'true');
  const [scanSensitivity, setScanSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem('scannerSensitivity');
    return saved ? parseInt(saved, 10) : 3; // Default 3 (Fast)
  });
  const [enabledTimeframes, setEnabledTimeframes] = useState<Timeframe[]>(() => {
    const saved = localStorage.getItem('scannerEnabledTimeframes');
    return saved ? JSON.parse(saved) : [Timeframe.H1, Timeframe.H4, Timeframe.D1];
  });

  const [showDocumentation, setShowDocumentation] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Portfolio State
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>('SCANNER');

  const handleScan = useCallback(async (autoSelect: boolean = false, overrideTimeframes?: Timeframe[]) => {
    const currentScanId = ++lastScanId.current;
    setScanning(true);
    const tfsToUse = overrideTimeframes || enabledTimeframes;
    try {
      const results = await scanMarket(trackedTickers, scanSensitivity, tfsToUse);
      if (currentScanId === lastScanId.current) {
        setAlerts(results);
        // Auto-select only if explicitly requested (e.g. on first load)
        if (autoSelect && results.length > 0 && !selectedTicker) {
          handleSelectTicker(results[0].ticker);
        }
      }
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      if (currentScanId === lastScanId.current) {
        setScanning(false);
      }

      // PHASE 3: Background Refresh (Silent)
      // Now safe to re-enable with the optimized request queue and Binance integration
      (async () => {
        console.log("🔄 Starting background refresh for all tickers...");
        // Process in small batches or sequentially with our optimized queue
        for (const ticker of trackedTickers) {
          try {
            await fetchTickerData(ticker, false, 'LOW');
          } catch (e) {
            console.warn(`⚠️ Background sync failed for ${ticker}`, e);
          }
        }
        console.log("✅ Background refresh complete. Refreshing scanner signals...");

        // Final scan to update results with fresh data - ONLY COMMIT IF STILL LATEST
        if (currentScanId === lastScanId.current) {
          const freshAlerts = await scanMarket(trackedTickers, scanSensitivity, tfsToUse);
          if (currentScanId === lastScanId.current) {
            setAlerts(freshAlerts);
          }
        }
      })();
    }
  }, [trackedTickers, scanSensitivity, enabledTimeframes, selectedTicker]);

  // Load data from DB on mount
  useEffect(() => {
    const initDB = async () => {
      const savedTrades = await db.trades.toArray();
      setTrades(savedTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

      const savedWatchlist = await db.watchlist.toArray();
      if (savedWatchlist.length > 0) {
        setTrackedTickers(savedWatchlist.map(w => w.ticker));
      } else {
        // First run: save initial tickers to DB with STOCKS marketType
        const records = INITIAL_TICKERS.map(ticker => ({
          ticker,
          addedAt: new Date().toISOString(),
          marketType: 'STOCKS' as const
        }));
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

      const savedBacklog = await db.backlog.toArray();
      setBacklog(new Set(savedBacklog.map(b => b.ticker)));
    };
    initDB();

    // Subscribe to global sync changes
    const unsubscribe = subscribeToSyncs((tickers) => {
      setSyncingTickers(tickers);
    });

    return () => unsubscribe();
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

  const handleAddTicker = async (ticker: string, marketType: 'STOCKS' | 'CRYPTO') => {
    if (!trackedTickers.includes(ticker)) {
      setTrackedTickers(prev => [...prev, ticker]);
      // Save with marketType
      await db.watchlist.put({
        ticker,
        addedAt: new Date().toISOString(),
        marketType
      });
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

  const handleFilterChange = (newFilter: 'ALL' | 'BULLISH' | 'BEARISH') => {
    setFilter(newFilter);
    localStorage.setItem('scannerFilter', newFilter);
  };

  const handleMinDivergencesChange = (newMinDivergences: number) => {
    setMinDivergences(newMinDivergences);
    localStorage.setItem('scannerMinDivergences', newMinDivergences.toString());
  };

  const handleSortByRatingChange = (newSortByRating: boolean) => {
    setSortByRating(newSortByRating);
    localStorage.setItem('scannerSortByRating', newSortByRating.toString());
  };

  const handleDivergenceTypeChange = (val: 'REGULAR' | 'HIDDEN' | 'BOTH') => {
    setDivergenceType(val);
    localStorage.setItem('scannerDivergenceType', val);
  };
  const handleMinStrengthChange = (val: number) => {
    setMinStrength(val);
    localStorage.setItem('scannerMinStrength', val.toString());
  };
  const handleOnlyConfirmedChange = (val: boolean) => {
    setOnlyConfirmed(val);
    localStorage.setItem('scannerOnlyConfirmed', val.toString());
  };
  const handleOnlyTripleChange = (only: boolean) => {
    setOnlyTriple(only);
    localStorage.setItem('scannerOnlyTriple', String(only));
  };

  const handleHideStaleChange = (hide: boolean) => {
    setHideStale(hide);
    localStorage.setItem('scannerHideStale', String(hide));
  };

  const handleOnlyTrendAlignedChange = (only: boolean) => {
    setOnlyTrendAligned(only);
    localStorage.setItem('scannerTrendAligned', String(only));
  };

  const handleScanSensitivityChange = (sensitivity: number) => {
    setScanSensitivity(sensitivity);
    localStorage.setItem('scannerSensitivity', sensitivity.toString());
    handleScan(); // Re-scan with new sensitivity
  };
  const handleEnabledTimeframesChange = (tfs: Timeframe[]) => {
    setEnabledTimeframes(tfs);
    localStorage.setItem('scannerEnabledTimeframes', JSON.stringify(tfs));

    // Safety: Adjust minDivergences if it exceeds the new number of timeframes
    if (minDivergences > tfs.length) {
      handleMinDivergencesChange(tfs.length);
    }

    handleScan(false, tfs); // Re-scan when timeframes change - PASSING NEW TFS DIRECTLY TO AVOID STALE STATE
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

  const handleToggleBacklog = async (ticker: string) => {
    const isBacklogged = backlog.has(ticker);
    const newBacklog = new Set(backlog);

    if (isBacklogged) {
      newBacklog.delete(ticker);
      await db.backlog.delete(ticker);
    } else {
      newBacklog.add(ticker);
      await db.backlog.add({ ticker, addedAt: new Date().toISOString() });
    }

    setBacklog(newBacklog);
  };

  const handleHideBackloggedChange = (hide: boolean) => {
    setHideBacklogged(hide);
    localStorage.setItem('scannerHideBacklogged', hide.toString());
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

  const activeSyncingTickers = new Set(syncingTickers);
  if (selectedTicker && tickerData?.syncStatus) {
    if (Object.values(tickerData.syncStatus).some(s => !s)) {
      activeSyncingTickers.add(selectedTicker);
    }
  }

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans relative">
      {/* Moved Account Menu to Top Right */}
      <div className="absolute top-4 right-4 z-[90]">
        <div className="flex items-center gap-3 bg-slate-900/80 backdrop-blur-md p-1.5 pr-3 pl-1.5 rounded-full border border-slate-800 shadow-xl relative">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-indigo-500/20">
            AV
          </div>
          <div className="hidden md:block">
            <p className="text-[10px] font-bold text-white leading-none">Avi Dev</p>
            <p className="text-[9px] text-indigo-400 font-medium mt-0.5">PRO Account</p>
          </div>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="p-1 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-colors ml-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showUserMenu && (
            <div className="absolute top-12 right-0 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-top-2 duration-200">
              <div className="p-1">
                <button className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  My Profile
                </button>
                <button
                  onClick={() => {
                    setShowDocumentation(true);
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-indigo-300 hover:bg-indigo-500/10 rounded-lg transition-colors flex items-center gap-2 font-bold"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                  Documentation
                </button>
                <button className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Settings
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
              filter={filter}
              onFilterChange={handleFilterChange}
              minDivergences={minDivergences}
              onMinDivergencesChange={handleMinDivergencesChange}
              sortByRating={sortByRating}
              onSortByRatingChange={handleSortByRatingChange}
              backlog={backlog}
              onToggleBacklog={handleToggleBacklog}
              hideBacklogged={hideBacklogged}
              onHideBackloggedChange={handleHideBackloggedChange}
              showHidden={divergenceType}
              onShowHiddenChange={handleDivergenceTypeChange}
              minStrength={minStrength}
              onMinStrengthChange={handleMinStrengthChange}
              onlyConfirmed={onlyConfirmed}
              onOnlyConfirmedChange={handleOnlyConfirmedChange}
              onlyTriple={onlyTriple}
              onOnlyTripleChange={handleOnlyTripleChange}
              hideStale={hideStale}
              onHideStaleChange={handleHideStaleChange}
              onlyTrendAligned={onlyTrendAligned}
              onOnlyTrendAlignedChange={handleOnlyTrendAlignedChange}
              scanSensitivity={scanSensitivity}
              onScanSensitivityChange={handleScanSensitivityChange}
              enabledTimeframes={enabledTimeframes}
              onEnabledTimeframesChange={handleEnabledTimeframesChange}
              openTrades={new Set(trades.map(t => t.ticker))}
              syncingTickers={activeSyncingTickers}
            />
          ) : sidebarView === 'WATCHLIST' ? (
            <TickerManagementPanel
              tickers={trackedTickers}
              onAddTicker={handleAddTicker}
              onRemoveTicker={handleRemoveTicker}
              onSelectTicker={handleSelectTicker}
              activeTicker={selectedTicker}
              tickerNotes={scannedStockNotes}
              openTrades={new Set(trades.map(t => t.ticker))}
              syncingTickers={activeSyncingTickers}
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
        isOpenTrade={selectedTicker ? trades.some(t => t.ticker === selectedTicker) : false}
      />

      {/* Documentation Modal */}
      <DocumentationModal
        isOpen={showDocumentation}
        onClose={() => setShowDocumentation(false)}
      />
    </div>
  );
}

export default App;