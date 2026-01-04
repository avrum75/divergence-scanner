import { OhlcvData, Timeframe, TickerSearchResult, IndicatorData, ConsolidatedAlert, SignalType, IndicatorType } from '../types';
import { calculateRSI, calculateMACD, calculateEMA, scanForDivergences } from '../utils/technicalAnalysis';
import { api } from './api';

const POLYGON_API_KEY = (process.env as any).POLYGON_API_KEY || '';
const BASE_URL = 'https://api.polygon.io/v2/aggs/ticker';

// --- Priority Queue System ---

enum Priority {
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
    const status = await api.getSyncStatus(syncId);

    // Quick cache check
    const now = Date.now();
    let tfDuration = (timeframe === Timeframe.D1) ? 86400000 : (timeframe === Timeframe.H4 ? 14400000 : 3600000);

    if (status) {
      const lastSync = new Date(status.last_sync).getTime();
      const throttleThreshold = (timeframe === Timeframe.D1) ? 3600000 : 300000; // 1h or 5m throttle

      if (now - lastSync < throttleThreshold) {
        // We synced recently. Return existing bars.
        const cachedBars = await api.getBars(normalizedTicker, timeframe);
        return addIndicators(cachedBars.sort((a: any, b: any) => a.time.localeCompare(b.time)));
      }
    }

    // Check data freshness
    const latestBars = await api.getBars(normalizedTicker, timeframe);
    const sortedBars = latestBars.sort((a: any, b: any) => a.time.localeCompare(b.time));
    const latestBar = sortedBars.length > 0 ? sortedBars[sortedBars.length - 1] : null;
    const lastBarTime = latestBar ? new Date(latestBar.time).getTime() : 0;

    // If we have recent data, skip full sync
    if (latestBar && (now - lastBarTime < tfDuration * 2)) {
      return addIndicators(sortedBars);
    }
  }

  // 2. Sync Logic
  // Define time range
  let targetDays = 180;
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
  return addIndicators(finalBars.sort((a: any, b: any) => a.time.localeCompare(b.time)));
};


export const fetchTickerData = async (ticker: string, force: boolean = false, priorityString: 'HIGH' | 'LOW' = 'LOW'): Promise<any> => {
  // ... Implement wrapper calling performSync ...
  const priority = priorityString === 'HIGH' ? Priority.HIGH : Priority.LOW;
  // For now simple sync
  try {
    await performSync(ticker, Timeframe.D1, force, priority);
    await performSync(ticker, Timeframe.H4, force, priority);
    await performSync(ticker, Timeframe.H1, force, priority);
  } catch (e) {
    console.error(e);
  }
  return getCachedTickerData(ticker);
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

export const scanMarket = async (watchlist: string[]): Promise<ConsolidatedAlert[]> => {
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

      const checkTimeframe = (tf: Timeframe) => {
        const data = cachedData.data[tf];
        if (!data || data.length < 50) return;

        // RSI
        const rsiDiv = scanForDivergences(data, IndicatorType.RSI);
        if (rsiDiv) {
          alertObj.signals.push({
            timeframe: tf,
            signalType: rsiDiv.signalType,
            indicator: IndicatorType.RSI,
            description: rsiDiv.description,
            isHidden: rsiDiv.isHidden,
            strength: rsiDiv.strength,
            isTriple: rsiDiv.isTriple,
            isConfirmed: true, // Placeholder
            isStale: rsiDiv.isStale,
            isTrendAligned: rsiDiv.isTrendAligned
          });
        }

        // MACD
        const macdDiv = scanForDivergences(data, IndicatorType.MACD);
        if (macdDiv) {
          alertObj.signals.push({
            timeframe: tf,
            signalType: macdDiv.signalType,
            indicator: IndicatorType.MACD,
            description: macdDiv.description,
            isHidden: macdDiv.isHidden,
            strength: macdDiv.strength,
            isTriple: macdDiv.isTriple,
            isConfirmed: true,
            isStale: macdDiv.isStale,
            isTrendAligned: macdDiv.isTrendAligned
          });
        }
      };

      checkTimeframe(Timeframe.D1);
      checkTimeframe(Timeframe.H4);
      checkTimeframe(Timeframe.H1);

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

export const getCachedTickerData = async (ticker: string): Promise<any> => {
  // Fetch from API
  const d1 = await api.getBars(ticker, Timeframe.D1);
  const h4 = await api.getBars(ticker, Timeframe.H4);
  const h1 = await api.getBars(ticker, Timeframe.H1);

  return {
    symbol: ticker,
    data: {
      [Timeframe.D1]: addIndicators(d1),
      [Timeframe.H4]: addIndicators(h4),
      [Timeframe.H1]: addIndicators(h1)
    },
    livePrice: d1.length > 0 ? d1[d1.length - 1].close : 0
  };
  return [];
};