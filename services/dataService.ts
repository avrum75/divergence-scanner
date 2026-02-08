import { OhlcvData, Timeframe, TickerSearchResult, IndicatorData, ConsolidatedAlert, SignalType, IndicatorType } from '../types';
import { calculateRSI, calculateMACD, calculateEMA, scanForDivergences } from '../utils/technicalAnalysis';
import { api } from './api';

const POLYGON_API_KEY = (process.env as any).POLYGON_API_KEY || '';
const BASE_URL = 'https://api.polygon.io/v2/aggs/ticker';

// --- Priority Queue System ---

export enum Priority {
  HIGH = 0, // Manual ticker selection
  LOW = 1,  // Background scanner
}

type Task = () => Promise<any>;

class RequestQueue {
  private queue: { task: Task; priority: Priority; resolve: (val: any) => void; reject: (err: any) => void }[] = [];
  private lastCallTime = 0;
  private minInterval = 5; // Paid tier: very low interval
  private maxConcurrent = 20; // Process up to 20 requests concurrently
  private currentActive = 0;
  private processing = false;

  async enqueue<T>(task: Task, priority: Priority): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, priority, resolve, reject });
      // Sort: HIGH priority first
      this.queue.sort((a, b) => a.priority - b.priority);
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      if (this.currentActive >= this.maxConcurrent) {
        // Wait a bit and check again if we hit concurrency limit
        await new Promise(res => setTimeout(res, 10));
        continue;
      }

      const now = Date.now();
      const timeSinceLast = now - this.lastCallTime;

      if (timeSinceLast < this.minInterval) {
        await new Promise(res => setTimeout(res, this.minInterval - timeSinceLast));
      }

      const item = this.queue.shift();
      if (!item) break;

      this.lastCallTime = Date.now();
      this.currentActive++;

      // Execute task without awaiting it to allow concurrency
      item.task().then(result => {
        item.resolve(result);
      }).catch(err => {
        item.reject(err);
      }).finally(() => {
        this.currentActive--;
        // Re-trigger process to handle next item in queue
        this.process();
      });
    }

    this.processing = false;
  }
}

const apiQueue = new RequestQueue();

// In-memory cache for recently synced data to avoid redundant DB reads
// Key: "TICKER:TIMEFRAME", Value: { data: IndicatorData[], timestamp: number }
const syncDataCache = new Map<string, { data: IndicatorData[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Wraps a fetch call in the priority queue
 */
const queuedFetch = async (url: string, priority: Priority): Promise<any> => {
  return apiQueue.enqueue(async () => {
    let attempts = 0;
    const isSnapshotEndpoint = url.includes('/snapshot/');

    while (attempts < 5) { // Safety limit
      attempts++;
      // Don't log snapshot endpoint calls to reduce console noise
      if (!isSnapshotEndpoint) {
        console.log(`Queued API call (Try ${attempts}): ${url.split('apiKey=')[0]}...`);
      }
      const resp = await fetch(url);

      // Handle rate limiting with exponential backoff
      if (resp.status === 429) {
        const backoffTime = Math.min(10000 * attempts, 30000); // Max 30s, exponential backoff
        console.warn(`429 Rate Limit! Waiting ${backoffTime / 1000}s...`);
        await new Promise(r => setTimeout(r, backoffTime));
        continue;
      }

      // Handle client errors (403, 404) - don't retry these
      if (resp.status >= 400 && resp.status < 500) {
        const errorText = await resp.text().catch(() => 'Unknown error');
        if (isSnapshotEndpoint && (resp.status === 403 || resp.status === 404)) {
          return null;
        }
        console.error(`API Error ${resp.status} for ${url.split('apiKey=')[0]}: ${errorText.substring(0, 100)}`);
        throw new Error(`API Error ${resp.status}: ${errorText.substring(0, 200)}`);
      }

      // Handle server errors (500+) - retry
      if (resp.status >= 500) {
        console.warn(`Server error ${resp.status}, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempts));
        continue;
      }

      // Success - parse JSON
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      try {
        return await resp.json();
      } catch (e) {
        const text = await resp.text();
        console.error(`JSON parse error for ${url.split('apiKey=')[0]}:`, text.substring(0, 200));
        throw new Error(`Invalid JSON response: ${text.substring(0, 200)}`);
      }
    }
    throw new Error(`Max retries exceeded for ${url}`);
  }, priority);
};

// --- Data Normalization ---

const normalizeTicker = (ticker: string): string => {
  const cleanTicker = ticker.toUpperCase().trim();

  // If already has X: prefix (from Binance search or manual entry), return as-is
  if (cleanTicker.startsWith('X:')) {
    return cleanTicker;
  }

  // Legacy support/defaults: convert common crypto symbols to Binance USDT format
  const crypto = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'DOGE', 'MATIC', 'POL'];
  if (crypto.includes(cleanTicker)) {
    return `X:${cleanTicker}USDT`;
  }

  return cleanTicker;
};

// --- Ticker Search ---

export type MarketType = 'STOCKS' | 'CRYPTO';

// Cache for Binance exchange info (refreshed every hour)
let binanceExchangeInfoCache: { symbols: any[]; timestamp: number } | null = null;
const BINANCE_CACHE_DURATION = 3600000; // 1 hour
let activeBinanceBaseUrl = 'https://api.binance.com';

/**
 * Fetch all trading pairs from Binance and cache them
 */
const getBinanceSymbols = async (): Promise<any[]> => {
  const now = Date.now();

  // Return cached data if still valid
  if (binanceExchangeInfoCache && (now - binanceExchangeInfoCache.timestamp < BINANCE_CACHE_DURATION)) {
    return binanceExchangeInfoCache.symbols;
  }

  const endpoints = [
    'https://api.binance.com',
    'https://api.binance.us' // Fallback for US users
  ];

  for (const baseUrl of endpoints) {
    try {
      const url = `${baseUrl}/api/v3/exchangeInfo`;
      console.log(`📡 Fetching Binance exchange info from ${new URL(baseUrl).hostname}...`);
      const response = await fetch(url);

      if (!response.ok) continue;

      const data = await response.json();

      if (data && data.symbols) {
        // More lenient filter: just check if TRADING
        const activeSymbols = data.symbols.filter((s: any) => s.status === 'TRADING');

        if (activeSymbols.length > 0) {
          console.log(`✅ Loaded ${activeSymbols.length} active Binance trading pairs from ${new URL(baseUrl).hostname}`);
          activeBinanceBaseUrl = baseUrl;
          binanceExchangeInfoCache = {
            symbols: activeSymbols,
            timestamp: now
          };
          return activeSymbols;
        }
      }
    } catch (e) {
      console.warn(`⚠️  Failed to fetch from ${baseUrl}:`, e);
    }
  }

  console.error("❌ Failed to fetch Binance exchange info from all sources");
  return binanceExchangeInfoCache ? binanceExchangeInfoCache.symbols : [];
};

/**
 * Search Binance trading pairs
 */
const searchBinanceTickers = async (query: string): Promise<TickerSearchResult[]> => {
  if (!query || query.length < 2) return [];

  try {
    console.log(`🔍 Searching Binance for: ${query}`);
    const symbols = await getBinanceSymbols();

    if (!symbols || symbols.length === 0) return [];

    const queryUpper = query.toUpperCase().trim();

    // Filter symbols that match the query
    const matches = symbols
      .filter((s: any) => {
        const symbol = (s.symbol || '').toUpperCase();
        const base = (s.baseAsset || '').toUpperCase();
        const quote = (s.quoteAsset || '').toUpperCase();

        return symbol.includes(queryUpper) ||
          base.includes(queryUpper) ||
          quote.includes(queryUpper);
      })
      .slice(0, 10) // Limit to 10 results
      .map((s: any) => ({
        ticker: `X:${s.symbol}`, // Prefix with X: to match Polygon crypto format
        name: `${s.baseAsset}/${s.quoteAsset}`,
        market: 'CRYPTO',
        type: 'crypto'
      }));

    return matches;
  } catch (e) {
    console.error("❌ Binance ticker search failed", e);
    return [];
  }
};

/**
 * Search Polygon stocks
 */
const searchPolygonTickers = async (query: string): Promise<TickerSearchResult[]> => {
  if (!query || query.length < 2) return [];

  const upperQuery = query.toUpperCase().trim();

  // Parallel fetch: 1. Search Results, 2. Exact Match Check
  const searchUrl = `https://api.polygon.io/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&sort=ticker&order=asc&limit=20&apiKey=${POLYGON_API_KEY}`;

  try {
    const [searchData, exactMatch] = await Promise.all([
      queuedFetch(searchUrl, Priority.HIGH).catch(() => ({ results: [] })),
      getTickerDetails(upperQuery).catch(() => null)
    ]);

    let results: TickerSearchResult[] = [];

    // If we found an exact match, put it first
    if (exactMatch) {
      results.push(exactMatch);
    }

    if (searchData && searchData.results) {
      const searchResults = searchData.results.map((r: any) => ({
        ticker: r.ticker,
        name: r.name,
        market: r.market,
        type: r.type
      }));

      // Filter out duplicates (if exact match was also in search results)
      const seen = new Set<string>();
      if (exactMatch) seen.add(exactMatch.ticker);

      for (const item of searchResults) {
        if (!seen.has(item.ticker)) {
          results.push(item);
          seen.add(item.ticker);
        }
      }
    }

    return results.slice(0, 10); // Return top 10
  } catch (e) {
    console.error("Polygon ticker search failed", e);
    return [];
  }
};

/**
 * Search tickers based on market type
 */
export const searchTickers = async (query: string, marketType: MarketType = 'STOCKS'): Promise<TickerSearchResult[]> => {
  if (marketType === 'CRYPTO') {
    return searchBinanceTickers(query);
  } else {
    return searchPolygonTickers(query);
  }
};

/**
 * Get ticker details (name, market, etc.) for a single ticker
 */
export const getTickerDetails = async (ticker: string): Promise<TickerSearchResult | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const url = `https://api.polygon.io/v3/reference/tickers/${normalizedTicker}?apiKey=${POLYGON_API_KEY}`;

  try {
    const data = await queuedFetch(url, Priority.LOW);
    if (data && data.results) {
      const r = data.results;
      return {
        ticker: r.ticker || normalizedTicker,
        name: r.name || '',
        market: r.market || '',
        type: r.type || ''
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

// --- Core Sync Logic ---

const pendingSyncs = new Map<string, Promise<OhlcvData[]>>();

type SyncListener = (syncingTickers: Set<string>) => void;
const syncListeners = new Set<SyncListener>();

export const subscribeToSyncs = (listener: SyncListener) => {
  syncListeners.add(listener);
  const tickers = new Set<string>();
  pendingSyncs.forEach((_, key) => tickers.add(key.split(':')[0]));
  listener(tickers);
  return () => { syncListeners.delete(listener); };
};

const checkForUpdates = async (ticker: string, timeframe: Timeframe, priority: Priority): Promise<string | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const isCrypto = normalizedTicker.startsWith('X:');
  let url: string;

  if (isCrypto) {
    const binanceSymbol = normalizedTicker.replace('X:', '');
    const interval = timeframe === Timeframe.D1 ? '1d' : (timeframe === Timeframe.H4 ? '4h' : '1h');
    url = `${activeBinanceBaseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1`;
  } else {
    const multiplier = timeframe === Timeframe.D1 ? 1 : (timeframe === Timeframe.H4 ? 4 : 1);
    const timespan = timeframe === Timeframe.D1 ? 'day' : 'hour';
    const toDate = new Date().toISOString().split('T')[0];
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 7 days
    url = `${BASE_URL}/${normalizedTicker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=desc&limit=1&apiKey=${POLYGON_API_KEY}`;
  }

  try {
    const data = await queuedFetch(url, priority);

    if (isCrypto) {
      if (Array.isArray(data) && data.length > 0) {
        return new Date(data[0][0]).toISOString();
      }
    } else {
      if (data && data.results && data.results.length > 0) {
        return new Date(data.results[0].t).toISOString();
      }
    }
    return null;
  } catch (e) {
    return null;
  }
};

const performSync = async (ticker: string, timeframe: Timeframe, force: boolean = false, priority: Priority = Priority.LOW): Promise<OhlcvData[]> => {
  const normalizedTicker = normalizeTicker(ticker);
  const syncId = `${normalizedTicker}:${timeframe}`;
  let shouldForceSync = force;

  // 1. Check if we actually need to sync
  if (!shouldForceSync) {
    const now = Date.now();

    // FAST PATH: Check in-memory cache first (avoids DB + API calls entirely)
    const memCache = syncDataCache.get(syncId);
    if (memCache && now - memCache.timestamp < CACHE_TTL) {
      return memCache.data;
    }

    const status = await api.getSyncStatus(syncId);

    if (status) {
      const lastSync = new Date(status.last_sync).getTime();
      const throttleThreshold = priority === Priority.HIGH
        ? 120000 // 2 min for user-initiated scans
        : (timeframe === Timeframe.D1) ? 600000 : 300000; // 10 min for D1, 5 min for H1/H4

      if (now - lastSync < throttleThreshold) {
        // We synced recently. Return existing bars from DB (no API call).
        const cachedBars = await api.getBars(normalizedTicker, timeframe);
        const result = addIndicators(cachedBars.sort((a: any, b: any) => a.time.localeCompare(b.time)));
        syncDataCache.set(syncId, { data: result, timestamp: Date.now() });
        return result;
      }
    }

    // For LOW priority (background), use time-based staleness check ONLY (no market API call).
    // This avoids the expensive checkForUpdates call that generates many API requests.
    const latestBars = await api.getBars(normalizedTicker, timeframe);
    const sortedBars = latestBars.sort((a: any, b: any) => a.time.localeCompare(b.time));
    const latestBar = sortedBars.length > 0 ? sortedBars[sortedBars.length - 1] : null;

    if (latestBar) {
      const lastBarTime = new Date(latestBar.time).getTime();
      const tfDuration = (timeframe === Timeframe.D1) ? 86400000 : (timeframe === Timeframe.H4 ? 14400000 : 3600000);

      if (priority === Priority.LOW) {
        // Background sync: if our last bar is within 2 candle durations, skip sync
        if (now - lastBarTime < tfDuration * 2) {
          const result = addIndicators(sortedBars);
          syncDataCache.set(syncId, { data: result, timestamp: Date.now() });
          return result;
        }
      } else {
        // HIGH priority: check market for the latest available bar
        const latestAvailableBarTime = await checkForUpdates(normalizedTicker, timeframe, priority);

        if (latestAvailableBarTime) {
          const ourLatestBarTime = new Date(latestBar.time).getTime();
          const marketLatestBarTime = new Date(latestAvailableBarTime).getTime();

          // If we have the latest available bar (or newer), we're good
          if (ourLatestBarTime >= marketLatestBarTime) {
            const result = addIndicators(sortedBars);
            syncDataCache.set(syncId, { data: result, timestamp: Date.now() });
            return result;
          }
        } else {
          // Can't reach market — fall back to time-based check
          if (now - lastBarTime < tfDuration * 2) {
            const result = addIndicators(sortedBars);
            syncDataCache.set(syncId, { data: result, timestamp: Date.now() });
            return result;
          }
        }
      }
    }
  }

  // 2. Sync Logic
  // Define time range
  let targetDays = 180; // Default: 6 months for initial load
  if (timeframe === Timeframe.H1) targetDays = 60; // Max ~2 months for H1 to speed up

  const now = Date.now();
  const startTime = now - targetDays * 24 * 60 * 60 * 1000;

  // Align start time to day boundary to be clean
  const startDate = new Date(startTime);
  startDate.setHours(0, 0, 0, 0);

  const allBars: OhlcvData[] = [];
  let currentStart = startDate.getTime();
  const loopEnd = now;

  // Loop fetching
  // Use a safety break to prevent infinite loops in case of logic errors
  let loopCount = 0;
  const MAX_LOOPS = 50;

  while (currentStart < loopEnd && loopCount < MAX_LOOPS) {
    loopCount++;

    // Construct URL
    const isCrypto = normalizedTicker.startsWith('X:');
    let url: string;

    // Formatting start/end for API
    // Polygon accepts timestamps in milliseconds.
    // We use the timestamp directly.

    if (isCrypto) {
      const binanceSymbol = normalizedTicker.replace('X:', '');
      let interval = '1d';
      if (timeframe === Timeframe.H4) interval = '4h';
      else if (timeframe === Timeframe.H1) interval = '1h';

      // Binance API limit 1000
      url = `${activeBinanceBaseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${currentStart}&endTime=${loopEnd}&limit=1000`;
    } else {
      let multiplier = 1;
      let timespan = 'day';
      if (timeframe === Timeframe.H4) { multiplier = 4; timespan = 'hour'; }
      else if (timeframe === Timeframe.H1) { multiplier = 1; timespan = 'hour'; }

      // Polygon API limit 50000 (we use 5000)
      // Note: Polygon range endpoint expects YYYY-MM-DD for 'day' timespan, 
      // but supports timestamps for intraday.
      // To be safe, we'll format based on timespan.

      let startParam = currentStart.toString();
      let endParam = loopEnd.toString();

      if (timeframe === Timeframe.D1) {
        startParam = new Date(currentStart).toISOString().split('T')[0];
        endParam = new Date(loopEnd).toISOString().split('T')[0];
      }

      url = `${BASE_URL}/${normalizedTicker}/range/${multiplier}/${timespan}/${startParam}/${endParam}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;
    }

    try {
      const data = await queuedFetch(url, priority);

      // Normalize results
      let newRawBars: any[] = [];
      if (isCrypto) {
        if (Array.isArray(data)) {
          newRawBars = data.map((k: any) => ({
            t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
          }));
        }
      } else {
        if (data && data.results) {
          newRawBars = data.results;
        }
      }

      if (newRawBars.length > 0) {
        const processedBars = newRawBars
          .filter((r: any) => r.t <= now)
          .map((r: any) => ({
            ticker: normalizedTicker,
            timeframe,
            time: new Date(r.t).toISOString(),
            open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v
          }));

        allBars.push(...processedBars);

        // Advance currentStart
        const lastBarTime = newRawBars[newRawBars.length - 1].t;

        // Advance by 1 unit to avoid duplicates/stuck loop
        // H4 = 14400000, H1 = 3600000, D1 = 86400000
        const step = timeframe === Timeframe.D1 ? 86400000 : (timeframe === Timeframe.H4 ? 14400000 : 3600000);

        // Ensure we strictly move forward
        const nextStart = lastBarTime + step;
        if (nextStart <= currentStart) {
          currentStart += step; // Fallback if data time is weird
        } else {
          currentStart = nextStart;
        }

        // Break if we are up to date (close enough to loopEnd)
        if (currentStart >= loopEnd) break;

      } else {
        // No more data found in this range
        break;
      }

    } catch (e) {
      console.error(`Sync error for ${syncId}:`, e);
      break;
    }
  }

  // 3. Save and Update Status
  if (allBars.length > 0) {
    await api.createBars(allBars);
  }

  // ALWAYS update sync status if we ran the loop, so we don't retry endlessly immediately
  await api.updateSyncStatus(syncId, new Date().toISOString());

  // Return fresh data from DB (re-fetch to ensure order and consistency)
  const finalBars = await api.getBars(normalizedTicker, timeframe);
  const result = addIndicators(finalBars.sort((a: any, b: any) => a.time.localeCompare(b.time)));
  syncDataCache.set(syncId, { data: result, timestamp: Date.now() });
  return result;
};


export const fetchTickerData = async (ticker: string, force: boolean = false, priorityString: 'HIGH' | 'LOW' = 'LOW'): Promise<any> => {
  const priority = priorityString === 'HIGH' ? Priority.HIGH : Priority.LOW;
  try {
    await Promise.all([
      performSync(ticker, Timeframe.D1, force, priority),
      performSync(ticker, Timeframe.H4, force, priority),
      performSync(ticker, Timeframe.H1, force, priority),
    ]);
  } catch (e) {
    console.error(e);
  }
  return getCachedTickerData(ticker);
};

/**
 * Fetch 12 months of historical 1D data for a ticker (graceful background load)
 * This extends the existing data without deleting old data
 */
export const fetchHistorical1DData = async (ticker: string, priorityString: 'HIGH' | 'LOW' = 'HIGH'): Promise<void> => {
  const normalizedTicker = normalizeTicker(ticker);
  const priority = priorityString === 'HIGH' ? Priority.HIGH : Priority.LOW;
  
  // Check if we already have 12 months of data
  const existingBars = await api.getBars(normalizedTicker, Timeframe.D1);
  if (existingBars.length > 0) {
    const sortedBars = existingBars.sort((a: any, b: any) => a.time.localeCompare(b.time));
    const oldestBar = sortedBars[0];
    const oldestBarTime = new Date(oldestBar.time).getTime();
    const now = Date.now();
    const twelveMonthsAgo = now - (365 * 24 * 60 * 60 * 1000); // 12 months in milliseconds
    
    // If we already have data older than 12 months, skip
    if (oldestBarTime <= twelveMonthsAgo) {
      console.log(`✅ ${normalizedTicker} already has 12+ months of 1D data`);
      return;
    }
  }

  console.log(`📊 Loading 12 months of historical 1D data for ${normalizedTicker}...`);
  
  // Use performSync with extended range for 1D data
  const now = Date.now();
  const twelveMonthsAgo = now - (365 * 24 * 60 * 60 * 1000);
  
  // Align to day boundary
  const startDate = new Date(twelveMonthsAgo);
  startDate.setHours(0, 0, 0, 0);
  
  const allBars: OhlcvData[] = [];
  let currentStart = startDate.getTime();
  const loopEnd = now;
  
  const isCrypto = normalizedTicker.startsWith('X:');
  let loopCount = 0;
  const MAX_LOOPS = 50;
  
  while (currentStart < loopEnd && loopCount < MAX_LOOPS) {
    loopCount++;
    
    let url: string;
    
    if (isCrypto) {
      const binanceSymbol = normalizedTicker.replace('X:', '');
      url = `${activeBinanceBaseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=1d&startTime=${currentStart}&endTime=${loopEnd}&limit=1000`;
    } else {
      const startParam = new Date(currentStart).toISOString().split('T')[0];
      const endParam = new Date(loopEnd).toISOString().split('T')[0];
      url = `${BASE_URL}/${normalizedTicker}/range/1/day/${startParam}/${endParam}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;
    }
    
    try {
      const data = await queuedFetch(url, priority);
      
      let newRawBars: any[] = [];
      if (isCrypto) {
        if (Array.isArray(data)) {
          newRawBars = data.map((k: any) => ({
            t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
          }));
        }
      } else {
        if (data && data.results) {
          newRawBars = data.results;
        }
      }
      
      if (newRawBars.length > 0) {
        const processedBars = newRawBars
          .filter((r: any) => r.t <= now)
          .map((r: any) => ({
            ticker: normalizedTicker,
            timeframe: Timeframe.D1,
            time: new Date(r.t).toISOString(),
            open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v
          }));
        
        allBars.push(...processedBars);
        
        // Advance currentStart
        const lastBarTime = newRawBars[newRawBars.length - 1].t;
        const step = 86400000; // 1 day in milliseconds
        const nextStart = lastBarTime + step;
        
        if (nextStart <= currentStart) {
          currentStart += step;
        } else {
          currentStart = nextStart;
        }
        
        if (currentStart >= loopEnd) break;
      } else {
        break;
      }
    } catch (e) {
      console.error(`Error fetching historical 1D data for ${normalizedTicker}:`, e);
      break;
    }
  }
  
  // Save the historical data (will merge with existing data in DB)
  if (allBars.length > 0) {
    await api.createBars(allBars);
    console.log(`✅ Loaded ${allBars.length} additional 1D bars for ${normalizedTicker}`);
  }
};

const addIndicators = (bars: OhlcvData[]): IndicatorData[] => {
  if (!bars || bars.length === 0) return [];

  const closes = bars.map(b => b.close);

  // Calculate Indicators
  const rsi = calculateRSI(closes);
  const { macdLine, signalLine, histogram } = calculateMACD(closes);
  const ema = calculateEMA(closes, 20);

  // Merge back
  return bars.map((bar, i) => ({
    ...bar,
    rsi: rsi[i],
    macd: macdLine[i],
    macdSignal: signalLine[i],
    macdHist: histogram[i],
    ema: ema[i]
  }));
};

export const scanMarket = async (watchlist: string[], sensitivity: number = 3): Promise<ConsolidatedAlert[]> => {
  const alertsMap = new Map<string, ConsolidatedAlert>();

  for (const ticker of watchlist) {
    try {
      const cachedData = await getCachedTickerData(ticker);
      if (!cachedData) continue;

      // Initialize alert object for this ticker
      if (!alertsMap.has(ticker)) {
        const lastBar = cachedData.data[Timeframe.D1]?.slice(-1)[0] ||
          cachedData.data[Timeframe.H4]?.slice(-1)[0] ||
          cachedData.data[Timeframe.H1]?.slice(-1)[0];

        if (lastBar) {
          alertsMap.set(ticker, {
            ticker,
            signals: [],
            price: lastBar.close,
            timestamp: lastBar.time,
            discoveredAt: new Date().toISOString()
          });
        }
      }

      const alertObj = alertsMap.get(ticker);
      if (!alertObj) continue;

      // Collect RSI and MACD signals per timeframe for confirmed logic
      const rsiSignalsByTf: Record<string, any[]> = {};
      const macdSignalsByTf: Record<string, any[]> = {};

      const checkTimeframe = (tf: Timeframe) => {
        const data = cachedData.data[tf];
        if (!data || data.length < 50) return;

        // scanForDivergences now returns an array of all signals found
        const rsiDivs = scanForDivergences(data, IndicatorType.RSI, sensitivity);
        const macdDivs = scanForDivergences(data, IndicatorType.MACD, sensitivity);

        rsiSignalsByTf[tf] = rsiDivs;
        macdSignalsByTf[tf] = macdDivs;

        // --- IMPROVEMENT 1: Real confirmed logic ---
        // A signal is "confirmed" when RSI and MACD both show a divergence
        // in the same direction (both bullish or both bearish) on this timeframe
        const isBullishSignal = (s: any) =>
          s.signalType === SignalType.BULLISH_DIVERGENCE || s.signalType === SignalType.BULLISH_HIDDEN;
        const isBearishSignal = (s: any) =>
          s.signalType === SignalType.BEARISH_DIVERGENCE || s.signalType === SignalType.BEARISH_HIDDEN;

        const rsiBullish = rsiDivs.some(isBullishSignal);
        const rsiBearish = rsiDivs.some(isBearishSignal);
        const macdBullish = macdDivs.some(isBullishSignal);
        const macdBearish = macdDivs.some(isBearishSignal);

        const bullishConfirmed = rsiBullish && macdBullish;
        const bearishConfirmed = rsiBearish && macdBearish;

        // Push RSI signals
        for (const div of rsiDivs) {
          const confirmed = isBullishSignal(div) ? bullishConfirmed : bearishConfirmed;
          alertObj.signals.push({
            timeframe: tf,
            signalType: div.signalType,
            indicator: IndicatorType.RSI,
            description: div.description,
            isHidden: div.isHidden,
            strength: confirmed ? Math.min((div.strength || 0) + 10, 100) : div.strength,
            isTriple: div.isTriple,
            isConfirmed: confirmed,
            isStale: div.isStale,
            isTrendAligned: div.isTrendAligned
          });
        }

        // Push MACD signals
        for (const div of macdDivs) {
          const confirmed = isBullishSignal(div) ? bullishConfirmed : bearishConfirmed;
          alertObj.signals.push({
            timeframe: tf,
            signalType: div.signalType,
            indicator: IndicatorType.MACD,
            description: div.description,
            isHidden: div.isHidden,
            strength: confirmed ? Math.min((div.strength || 0) + 10, 100) : div.strength,
            isTriple: div.isTriple,
            isConfirmed: confirmed,
            isStale: div.isStale,
            isTrendAligned: div.isTrendAligned
          });
        }
      };

      checkTimeframe(Timeframe.D1);
      checkTimeframe(Timeframe.H4);
      checkTimeframe(Timeframe.H1);

      // --- IMPROVEMENT 4: Multi-timeframe confluence scoring ---
      // If multiple timeframes agree on direction, boost strength of all aligned signals
      if (alertObj.signals.length > 0) {
        const bullishTimeframes = new Set<Timeframe>();
        const bearishTimeframes = new Set<Timeframe>();

        for (const sig of alertObj.signals) {
          if (sig.signalType === SignalType.BULLISH_DIVERGENCE || sig.signalType === SignalType.BULLISH_HIDDEN) {
            bullishTimeframes.add(sig.timeframe);
          }
          if (sig.signalType === SignalType.BEARISH_DIVERGENCE || sig.signalType === SignalType.BEARISH_HIDDEN) {
            bearishTimeframes.add(sig.timeframe);
          }
        }

        // Apply confluence bonus: +10 for 2 timeframes, +20 for 3 timeframes
        for (const sig of alertObj.signals) {
          const isBullish = sig.signalType === SignalType.BULLISH_DIVERGENCE || sig.signalType === SignalType.BULLISH_HIDDEN;
          const tfCount = isBullish ? bullishTimeframes.size : bearishTimeframes.size;

          if (tfCount >= 3) {
            sig.strength = Math.min((sig.strength || 0) + 20, 100);
          } else if (tfCount >= 2) {
            sig.strength = Math.min((sig.strength || 0) + 10, 100);
          }
        }
      }

      // Remove if no signals found
      if (alertObj.signals.length === 0) {
        alertsMap.delete(ticker);
      }

    } catch (e) {
      console.error(`Failed to scan ${ticker}`, e);
    }
  }

  return Array.from(alertsMap.values());
};

/**
 * Background sync for all tickers in watchlist
 * Runs silently in the background to keep data fresh
 * Only syncs if data is stale (performSync has built-in freshness checks)
 */
export const backgroundSyncWatchlist = async (
  watchlist: string[],
  priority: Priority = Priority.LOW
): Promise<void> => {
  if (watchlist.length === 0) return;

  console.log(`🔄 Starting background sync for ${watchlist.length} ticker(s)...`);

  const BATCH_SIZE = 5;

  for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
    const batch = watchlist.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (ticker) => {
      try {
        await Promise.all([
          performSync(ticker, Timeframe.D1, false, priority),
          performSync(ticker, Timeframe.H4, false, priority),
          performSync(ticker, Timeframe.H1, false, priority),
        ]);
      } catch (e) {
        console.error(`Background sync failed for ${ticker}:`, e);
      }
    }));
  }

  console.log(`✅ Background sync completed`);
};

export const getCachedTickerData = async (ticker: string): Promise<any> => {
  const normalizedTicker = normalizeTicker(ticker);
  const now = Date.now();

  // Check in-memory cache first (populated by performSync)
  const d1Cache = syncDataCache.get(`${normalizedTicker}:${Timeframe.D1}`);
  const h4Cache = syncDataCache.get(`${normalizedTicker}:${Timeframe.H4}`);
  const h1Cache = syncDataCache.get(`${normalizedTicker}:${Timeframe.H1}`);

  // Helper: fetch from DB, sort chronologically, then compute indicators
  const getFromDB = async (tf: Timeframe) => {
    const bars = await api.getBars(normalizedTicker, tf);
    return addIndicators(bars.sort((a: any, b: any) => a.time.localeCompare(b.time)));
  };

  const d1 = (d1Cache && now - d1Cache.timestamp < CACHE_TTL)
    ? d1Cache.data
    : await getFromDB(Timeframe.D1);
  const h4 = (h4Cache && now - h4Cache.timestamp < CACHE_TTL)
    ? h4Cache.data
    : await getFromDB(Timeframe.H4);
  const h1 = (h1Cache && now - h1Cache.timestamp < CACHE_TTL)
    ? h1Cache.data
    : await getFromDB(Timeframe.H1);

  return {
    symbol: ticker,
    data: {
      [Timeframe.D1]: d1,
      [Timeframe.H4]: h4,
      [Timeframe.H1]: h1
    },
    livePrice: d1.length > 0 ? d1[d1.length - 1].close : 0
  };
};