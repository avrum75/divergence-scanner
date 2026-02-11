import React, { useState, useEffect, useCallback } from 'react';
import AlertPanel from './components/AlertPanel';
import PortfolioPanel from './components/PortfolioPanel';
import TickerManagementPanel from './components/TickerManagementPanel';
import BacktestPanel from './components/BacktestPanel';
import ChartGrid from './components/ChartGrid';
import DocumentationModal from './components/DocumentationModal';
import { Radar, Eye, Briefcase, FlaskConical } from 'lucide-react';
import { scanMarket, fetchTickerData, getCachedTickerData, subscribeToSyncs, fetchHistorical1DData, backgroundSyncWatchlist, Priority } from './services/dataService';
import { api } from './services/api';
import { Alert, TickerData, Trade, Timeframe, ConsolidatedAlert } from './types';
import { TICKERS as INITIAL_TICKERS } from './constants';

type SidebarView = 'SCANNER' | 'PORTFOLIO' | 'WATCHLIST' | 'BACKTEST';

function App() {
  const [alerts, setAlerts] = useState<ConsolidatedAlert[]>([]);
  const lastScanId = React.useRef(0);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerData, setTickerData] = useState<TickerData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [trackedTickers, setTrackedTickers] = useState<string[]>(INITIAL_TICKERS);
  
  // Track scanning state
  const getInitialLastScanTime = (): number | null => {
    const saved = localStorage.getItem('lastScanTime');
    return saved ? parseInt(saved, 10) : null;
  };
  const getInitialScannedTickers = (): Set<string> => {
    const saved = localStorage.getItem('scannedTickers');
    return saved ? new Set(JSON.parse(saved)) : new Set<string>();
  };
  const lastScanTime = React.useRef<number | null>(getInitialLastScanTime());
  const [lastScanTimeState, setLastScanTimeState] = useState<number | null>(getInitialLastScanTime());
  const scannedTickers = React.useRef<Set<string>>(getInitialScannedTickers());
  const isInitialMount = React.useRef(true);
  const initialDataLoaded = React.useRef(false);
  const scanningRef = React.useRef(false);
  const scanSensitivityRef = React.useRef(
    parseInt(localStorage.getItem('scannerSensitivity') || '3', 10)
  );
  const [scannedStockRatings, setScannedStockRatings] = useState<Record<string, number>>({});
  const [scannedStockNotes, setScannedStockNotes] = useState<Record<string, { note: string; date: string }[]>>({});
  const [businessScores, setBusinessScores] = useState<Record<string, string>>({}); // ticker -> score (e.g., "6/7")
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
  const [sortBy, setSortBy] = useState<'newest' | 'rating'>(() => {
    const saved = localStorage.getItem('scannerSortBy');
    return (saved === 'rating' ? 'rating' : 'newest') as 'newest' | 'rating';
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
  const [showNewArrivals, setShowNewArrivals] = useState<boolean>(() => {
    const saved = localStorage.getItem('scannerShowNewArrivals');
    return saved === 'true';
  });
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

  const handleScan = useCallback(async (autoSelect: boolean = false, overrideTimeframes?: Timeframe[], tickersToScan?: string[]) => {
    const currentScanId = ++lastScanId.current;
    setScanning(true);
    scanningRef.current = true;
    const tfsToUse = overrideTimeframes || enabledTimeframes;
    const tickers = tickersToScan || trackedTickers;
    
    try {
      // Ensure data freshness before scanning (only syncs if stale)
      console.log("🔄 Ensuring data freshness before scan...");
      await backgroundSyncWatchlist(tickers, Priority.HIGH);
      
      // Now scan with fresh data
      const results = await scanMarket(tickers, scanSensitivity);
      if (currentScanId === lastScanId.current) {
        // Merge results with existing alerts (remove old alerts for scanned tickers, add new ones)
        setAlerts(prev => {
          const filtered = prev.filter(alert => !tickers.includes(alert.ticker));
          const merged = [...filtered, ...results];
          
          // Save results to database asynchronously
          api.saveScannerResults(merged).then(() => {
            console.log(`💾 Saved ${merged.length} scanner results to database`);
          }).catch((e) => {
            console.error("Failed to save scanner results:", e);
          });
          
          // Load business scores for newly scanned tickers
          if (tickers.length > 0) {
            api.getBusinessScores(tickers).then(scores => {
              setBusinessScores(prev => ({ ...prev, ...scores }));
            }).catch(e => {
              console.error("Failed to load business scores for scanned tickers:", e);
            });
          }
          
          return merged;
        });
        
        // Update scanned tickers tracking
        tickers.forEach(ticker => scannedTickers.current.add(ticker));
        lastScanTime.current = Date.now();
        setLastScanTimeState(Date.now());
        localStorage.setItem('lastScanTime', lastScanTime.current.toString());
        localStorage.setItem('scannedTickers', JSON.stringify(Array.from(scannedTickers.current)));
        
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
        scanningRef.current = false;
      }

      // REMOVED: Background refresh that was causing excessive API calls
      // Background refresh should only happen when user explicitly requests it,
      // not after every scan. The scan already uses cached data.
    }
  }, [trackedTickers, scanSensitivity, enabledTimeframes, selectedTicker]);

  // Load data from API on mount
  useEffect(() => {
    const initData = async () => {
      try {
        const savedTrades = await api.getTrades();
        setTrades(savedTrades.sort((a: Trade, b: Trade) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

        // STEP 1: Load watchlist FIRST (includes business_score)
        const savedWatchlist = await api.getWatchlist();
        let watchlistTickers: string[] = [];
        const businessScoresFromWatchlist: Record<string, string> = {};
        
        if (savedWatchlist.length > 0) {
          watchlistTickers = savedWatchlist.map((w: any) => w.ticker);
          setTrackedTickers(watchlistTickers);
          
          // Extract business scores from watchlist response
          savedWatchlist.forEach((w: any) => {
            if (w.business_score) {
              businessScoresFromWatchlist[w.ticker] = w.business_score;
            }
          });
        } else {
          // First run: save initial tickers to DB with STOCKS marketType
          for (const ticker of INITIAL_TICKERS) {
            await api.addToWatchlist(ticker, 'STOCKS');
          }
          watchlistTickers = INITIAL_TICKERS;
          setTrackedTickers(INITIAL_TICKERS);
        }

        // STEP 2: Set business scores from watchlist (available immediately)
        setBusinessScores(businessScoresFromWatchlist);

        // STEP 3: Load ratings
        const savedRatings = await api.getRatings();
        const ratings: Record<string, number> = {};
        savedRatings.forEach((r: any) => {
          ratings[r.ticker] = r.rating;
        });
        setScannedStockRatings(ratings);

        // STEP 4: Load notes
        const savedNotes = await api.getAllNotes();
        const notes: Record<string, { note: string; date: string }[]> = {};

        // Group notes by ticker if backend returns flat list
        savedNotes.forEach((n: any) => {
          if (!notes[n.ticker]) notes[n.ticker] = [];
          notes[n.ticker].push({ note: n.content, date: n.created_at });
        });

        setScannedStockNotes(notes);

        // STEP 5: Load backlog
        const savedBacklog = await api.getBacklog();
        setBacklog(new Set(savedBacklog.map((b: any) => b.ticker)));

        // STEP 6: Load scanner results LAST (after all watchlist data is loaded)
        const savedResults = await api.getScannerResults();
        if (savedResults && savedResults.length > 0) {
          console.log(`📊 Loaded ${savedResults.length} scanner results from database`);
          setAlerts(savedResults);
          // Mark all tickers in saved results as scanned
          savedResults.forEach((alert: ConsolidatedAlert) => {
            scannedTickers.current.add(alert.ticker);
          });
          // Update last scan time if we have results
          if (savedResults.length > 0) {
            const mostRecent = savedResults.reduce((latest: ConsolidatedAlert | null, alert: ConsolidatedAlert) => {
              if (!latest) return alert;
              const latestTime = new Date(latest.discoveredAt || latest.timestamp).getTime();
              const alertTime = new Date(alert.discoveredAt || alert.timestamp).getTime();
              return alertTime > latestTime ? alert : latest;
            }, null);
            if (mostRecent) {
              const resultTime = new Date(mostRecent.discoveredAt || mostRecent.timestamp).getTime();
              lastScanTime.current = resultTime;
              setLastScanTimeState(resultTime);
              localStorage.setItem('lastScanTime', lastScanTime.current.toString());
            }
          }
        }

        // Mark initial data as loaded
        initialDataLoaded.current = true;

      } catch (e) {
        console.error("Failed to load initial data", e);
        initialDataLoaded.current = true; // Mark as loaded even on error
      }
    };
    initData();

    // Subscribe to global sync changes
    const unsubscribe = subscribeToSyncs((tickers) => {
      setSyncingTickers(tickers);
    });

    // Listen for business analysis updates
    const handleBusinessAnalysisUpdate = async (event: CustomEvent) => {
      const { ticker, normalizedTicker, score } = event.detail;
      
      // If score is provided directly from the analysis, use it immediately
      if (score) {
        // Update for the original ticker format (to match alerts) and normalized format
        const tickerUpper = (ticker || '').toUpperCase().trim();
        const normalized = (normalizedTicker || tickerUpper.replace(/^X:/, '')).toUpperCase().trim();
        
        setBusinessScores(prev => {
          const updated = { ...prev };
          // Update both the original format and normalized format to ensure it matches
          updated[tickerUpper] = score;
          if (normalized !== tickerUpper) {
            updated[normalized] = score;
          }
          // Also handle X: prefix variations
          if (tickerUpper.startsWith('X:')) {
            updated[tickerUpper.replace(/^X:/, '')] = score;
          } else {
            updated[`X:${tickerUpper}`] = score;
          }
          return updated;
        });
        console.log(`✅ Updated business score for ${tickerUpper}: ${score}`);
      } else {
        // Fallback: Refresh business scores from watchlist (which includes the updated score)
        try {
          const watchlist = await api.getWatchlist();
          const updatedScores: Record<string, string> = {};
          watchlist.forEach((w: any) => {
            if (w.business_score) {
              // Update for both formats
              const tickerUpper = w.ticker.toUpperCase().trim();
              updatedScores[tickerUpper] = w.business_score;
              if (tickerUpper.startsWith('X:')) {
                updatedScores[tickerUpper.replace(/^X:/, '')] = w.business_score;
              } else {
                updatedScores[`X:${tickerUpper}`] = w.business_score;
              }
            }
          });
          setBusinessScores(prev => ({ ...prev, ...updatedScores }));
        } catch (e) {
          console.error("Failed to refresh business scores after update:", e);
        }
      }
    };

    window.addEventListener('businessAnalysisUpdated', handleBusinessAnalysisUpdate as EventListener);

    return () => {
      unsubscribe();
      window.removeEventListener('businessAnalysisUpdated', handleBusinessAnalysisUpdate as EventListener);
    };
  }, []);

  // Smart Initial Scan - only scan if no results exist or user explicitly requests it
  useEffect(() => {
    if (trackedTickers.length === 0) return;
    if (!initialDataLoaded.current) return; // Wait for initial data to load
    
    // On initial mount, check if we have saved results
    if (isInitialMount.current) {
      isInitialMount.current = false;
      
      // If we have alerts loaded from database, don't auto-scan
      // User must explicitly click the scan button to run a new scan
      if (alerts.length > 0) {
        console.log(`✅ Loaded ${alerts.length} scanner results from database. Click scan button to refresh.`);
        return;
      }
      
      // Only auto-scan if no results exist and last scan was more than 1 hour ago
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      const shouldScanAll = !lastScanTime.current || (now - lastScanTime.current) >= oneHour;
      
      if (shouldScanAll) {
        console.log("⏰ No saved results found and last scan was more than 1 hour ago, scanning all tickers...");
        handleScan(true);
      } else {
        console.log("✅ Recent scan found, skipping auto-scan. Use manual scan button if needed.");
        // Still check for new tickers that weren't scanned
        const newTickers = trackedTickers.filter(t => !scannedTickers.current.has(t));
        if (newTickers.length > 0) {
          console.log(`🆕 Found ${newTickers.length} new ticker(s), scanning them...`);
          handleScan(false, undefined, newTickers);
        }
      }
      return;
    }
    
    // On subsequent updates (ticker added/removed), only scan new tickers
    const newTickers = trackedTickers.filter(t => !scannedTickers.current.has(t));
    if (newTickers.length > 0) {
      console.log(`🆕 New ticker(s) added, scanning: ${newTickers.join(', ')}`);
      handleScan(false, undefined, newTickers);
    }
  }, [trackedTickers, handleScan, alerts.length]);

  // Load business scores when trackedTickers change (refresh from watchlist)
  useEffect(() => {
    if (trackedTickers.length > 0) {
      api.getWatchlist().then(watchlist => {
        const scores: Record<string, string> = {};
        watchlist.forEach((w: any) => {
          if (w.business_score) {
            scores[w.ticker] = w.business_score;
          }
        });
        setBusinessScores(prev => ({ ...prev, ...scores }));
      }).catch(e => {
        console.error("Failed to load business scores from watchlist:", e);
      });
    }
  }, [trackedTickers]);

  // Background data sync - runs every 30 minutes to keep data fresh, then re-scans
  useEffect(() => {
    if (trackedTickers.length === 0) return;

    const SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

    const doBackgroundRefresh = async () => {
      try {
        await backgroundSyncWatchlist(trackedTickers, Priority.LOW);

        // Re-scan after sync to update alerts (only if user isn't actively scanning)
        if (!scanningRef.current) {
          console.log("🔄 Background re-scan after sync...");
          const results = await scanMarket(trackedTickers, scanSensitivityRef.current);
          setAlerts(results);

          api.saveScannerResults(results).catch(e => {
            console.error("Failed to save background scan results:", e);
          });

          lastScanTime.current = Date.now();
          setLastScanTimeState(Date.now());
          localStorage.setItem('lastScanTime', lastScanTime.current.toString());

          // Update business scores
          if (trackedTickers.length > 0) {
            api.getBusinessScores(trackedTickers).then(scores => {
              setBusinessScores(prev => ({ ...prev, ...scores }));
            }).catch(() => {});
          }

          console.log(`✅ Background re-scan completed with ${results.length} alerts`);
        }
      } catch (e) {
        console.error("Background sync/scan failed:", e);
      }
    };

    // Initial background sync after 5 minutes (give app time to settle and avoid
    // overlapping with any manual scan the user might trigger on load)
    const initialTimeout = setTimeout(doBackgroundRefresh, 5 * 60 * 1000);

    // Then sync every 30 minutes
    const interval = setInterval(doBackgroundRefresh, SYNC_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [trackedTickers]);

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
            
            // After initial load, gracefully fetch 12 months of historical 1D data
            // Only if we don't already have substantial data
            const d1Data = freshData.data[Timeframe.D1];
            if (d1Data && d1Data.length > 0) {
              const oldestBarTime = new Date(d1Data[0].time).getTime();
              const twelveMonthsAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
              const hasSubstantialData = oldestBarTime <= twelveMonthsAgo;
              
              if (!hasSubstantialData) {
                fetchHistorical1DData(ticker, 'HIGH').then(() => {
                  // Refresh data after historical load completes
                  if (current === ticker) {
                    getCachedTickerData(ticker).then(updatedData => {
                      setTickerData(updatedData);
                    });
                  }
                }).catch(e => {
                  console.error("Failed to load historical 1D data:", e);
                });
              }
            }
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
      try {
        // Save to DB first to ensure consistency for child components fetching from DB
        await api.addToWatchlist(ticker, marketType);
        setTrackedTickers(prev => [...prev, ticker]);
      } catch (e) {
        console.error("Failed to add ticker to watchlist:", e);
      }
    }
  };

  const handleRemoveTicker = async (ticker: string) => {
    try {
      await api.removeFromWatchlist(ticker);
      setTrackedTickers(prev => prev.filter(t => t !== ticker));
      // Remove from alerts and scanned tickers
      setAlerts(prev => prev.filter(alert => alert.ticker !== ticker));
      scannedTickers.current.delete(ticker);
      localStorage.setItem('scannedTickers', JSON.stringify(Array.from(scannedTickers.current)));
    } catch (e) {
      console.error("Failed to remove ticker from watchlist:", e);
    }
  };

  const handleRatingChange = async (ticker: string, rating: number) => {
    setScannedStockRatings(prev => ({ ...prev, [ticker]: rating }));
    await api.setRating(ticker, rating);
  };

  const handleFilterChange = (newFilter: 'ALL' | 'BULLISH' | 'BEARISH') => {
    setFilter(newFilter);
    localStorage.setItem('scannerFilter', newFilter);
  };

  const handleMinDivergencesChange = (newMinDivergences: number) => {
    setMinDivergences(newMinDivergences);
    localStorage.setItem('scannerMinDivergences', newMinDivergences.toString());
  };

  const handleSortByChange = (newSortBy: 'newest' | 'rating') => {
    setSortBy(newSortBy);
    localStorage.setItem('scannerSortBy', newSortBy);
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
    scanSensitivityRef.current = sensitivity;
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

  const handleShowNewArrivalsChange = (show: boolean) => {
    setShowNewArrivals(show);
    localStorage.setItem('scannerShowNewArrivals', show.toString());
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

    await api.addNote(ticker, note.trim());
  };

  const handleToggleBacklog = async (ticker: string) => {
    const isBacklogged = backlog.has(ticker);
    const newBacklog = new Set(backlog);

    if (isBacklogged) {
      newBacklog.delete(ticker);
      await api.removeFromBacklog(ticker);
    } else {
      newBacklog.add(ticker);
      await api.addToBacklog(ticker);
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

    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      ticker,
      entryPrice: price,
      amount,
      type: 'LONG',
      timestamp: new Date().toISOString(),
      pnlPercent: (Math.random() * 2 - 1)
    };

    setTrades(prev => [newTrade, ...prev]);
    api.addTrade(newTrade);
    setSidebarView('PORTFOLIO');
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
          {([
            { key: 'SCANNER' as SidebarView, icon: Radar, label: 'Scanner' },
            { key: 'WATCHLIST' as SidebarView, icon: Eye, label: 'Watchlist' },
            { key: 'PORTFOLIO' as SidebarView, icon: Briefcase, label: 'Portfolio', badge: trades.length || undefined },
            { key: 'BACKTEST' as SidebarView, icon: FlaskConical, label: 'Backtest' },
          ]).map(({ key, icon: Icon, label, badge }) => (
            <button
              key={key}
              className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors ${sidebarView === key ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
              onClick={() => setSidebarView(key)}
              title={label}
            >
              <div className="relative">
                <Icon size={16} />
                {badge !== undefined && (
                  <span className="absolute -top-1.5 -right-2.5 bg-indigo-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{badge}</span>
                )}
              </div>
              <span className="text-[9px] font-medium">{label}</span>
            </button>
          ))}
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
              businessScores={businessScores}
              lastScanTime={lastScanTimeState}
              filter={filter}
              onFilterChange={handleFilterChange}
              minDivergences={minDivergences}
              onMinDivergencesChange={handleMinDivergencesChange}
              sortBy={sortBy}
              onSortByChange={handleSortByChange}
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
          ) : sidebarView === 'PORTFOLIO' ? (
            <PortfolioPanel
              trades={trades}
              onSelectTicker={handleSelectTicker}
            />
          ) : (
            <BacktestPanel
              tickers={trackedTickers}
              activeTicker={selectedTicker}
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