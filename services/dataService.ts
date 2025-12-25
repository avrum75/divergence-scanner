import { Alert, TickerData, Trade, Timeframe, OhlcvData, IndicatorData, SignalType, IndicatorType, ConsolidatedAlert } from '../types';
import { calculateRSI, calculateMACD, calculateEMA, scanForDivergences } from '../utils/technicalAnalysis';
import { TICKERS } from '../constants';
import { db, BarRecord } from '../db';

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
  private minInterval = 10; // Paid tier: very low interval (e.g. 10ms for 100 req/sec)
  private maxConcurrent = 10; // Process up to 10 requests concurrently
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
        // CRITICAL FIX: Silently return null for 403/404 on snapshot endpoints (expected for some tickers)
        // 403 = Not authorized (plan limitation), 404 = Not found (ticker doesn't exist)
        if (isSnapshotEndpoint && (resp.status === 403 || resp.status === 404)) {
          // Silently return null - these are expected failures for crypto snapshots on free tier
          return null;
        }
        // Log other client errors
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

  // Legacy support: convert common crypto symbols to Polygon format
  const crypto = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'DOGE', 'MATIC', 'POL'];
  if (crypto.includes(cleanTicker)) {
    return `X:${cleanTicker}USD`;
  }

  return cleanTicker;
};

// --- Ticker Search ---

import { TickerSearchResult } from '../types';

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
    console.log(`📊 Loaded ${symbols.length} Binance symbols`);

    if (!symbols || symbols.length === 0) {
      console.warn("⚠️  No Binance symbols loaded");
      return [];
    }

    const queryUpper = query.toUpperCase().trim();

    // Filter symbols that match the query (symbol, baseAsset, or quoteAsset)
    // Prioritize exact matches and base asset matches
    const matches = symbols
      .filter((s: any) => {
        const symbol = (s.symbol || '').toUpperCase();
        const base = (s.baseAsset || '').toUpperCase();
        const quote = (s.quoteAsset || '').toUpperCase();

        // Match if query is in symbol, base asset, or quote asset
        return symbol.includes(queryUpper) ||
          base.includes(queryUpper) ||
          quote.includes(queryUpper);
      })
      .sort((a: any, b: any) => {
        // Sort by relevance: exact base match first, then symbol starts with, then contains
        const aBase = (a.baseAsset || '').toUpperCase();
        const bBase = (b.baseAsset || '').toUpperCase();
        const aSymbol = (a.symbol || '').toUpperCase();
        const bSymbol = (b.symbol || '').toUpperCase();

        // Exact base match first
        if (aBase === queryUpper && bBase !== queryUpper) return -1;
        if (bBase === queryUpper && aBase !== queryUpper) return 1;

        // Symbol starts with query
        if (aSymbol.startsWith(queryUpper) && !bSymbol.startsWith(queryUpper)) return -1;
        if (bSymbol.startsWith(queryUpper) && !aSymbol.startsWith(queryUpper)) return 1;

        return 0;
      })
      .slice(0, 10) // Limit to 10 results
      .map((s: any) => ({
        ticker: `X:${s.symbol}`, // Prefix with X: to match Polygon crypto format
        name: `${s.baseAsset}/${s.quoteAsset}`,
        market: 'CRYPTO',
        type: 'crypto'
      }));

    console.log(`✅ Found ${matches.length} matches for "${query}"`);
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

  const url = `https://api.polygon.io/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&sort=ticker&order=asc&limit=10&apiKey=${POLYGON_API_KEY}`;

  try {
    const data = await queuedFetch(url, Priority.HIGH);
    if (data && data.results) {
      return data.results.map((r: any) => ({
        ticker: r.ticker,
        name: r.name,
        market: r.market,
        type: r.type
      }));
    }
    return [];
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
    // Polygon API returns single ticker data in data.results as an object
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
    // Silently fail - company name is optional
    return null;
  }
};

// --- Core Sync Logic ---

// In-memory map to deduplicate concurrent requests for the same syncId
const pendingSyncs = new Map<string, Promise<OhlcvData[]>>();

/**
 * Lightweight check: Fetch only the latest bar to see if there's new data
 * Returns the latest bar timestamp, or null if no data available
 */
const checkForUpdates = async (ticker: string, timeframe: Timeframe, priority: Priority): Promise<string | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const multiplier = timeframe === Timeframe.D1 ? 1 : (timeframe === Timeframe.H4 ? 4 : 1);
  const timespan = timeframe === Timeframe.D1 ? 'day' : 'hour';

  // Get the most recent bar (limit=1, sort=desc)
  const toDate = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Last 7 days

  const url = `${BASE_URL}/${normalizedTicker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=desc&limit=1&apiKey=${POLYGON_API_KEY}`;

  try {
    const data = await queuedFetch(url, priority);
    if (data && data.results && data.results.length > 0) {
      const latestBar = data.results[0];
      return new Date(latestBar.t).toISOString();
    }
    return null;
  } catch (e) {
    // If check fails, assume we need to sync (better safe than sorry)
    console.warn(`⚠️  Update check failed for ${normalizedTicker}:${timeframe}, will sync anyway:`, e);
    return null;
  }
};

/**
 * Internal function: Actual sync logic
 */
const performSync = async (ticker: string, timeframe: Timeframe, force: boolean = false, priority: Priority = Priority.LOW): Promise<OhlcvData[]> => {
  const normalizedTicker = normalizeTicker(ticker);
  const syncId = `${normalizedTicker}:${timeframe}`;

  // Use a local variable to track if we need to force sync (can't modify parameter)
  let shouldForceSync = force;

  // 1. Check if we actually need to sync (Throttling)
  if (!shouldForceSync) {
    let status = await db.syncStatus.get(syncId);
    // Check the LATEST bar in the DB for this ticker/timeframe
    const latestBar = await db.bars
      .where('[ticker+timeframe+time]')
      .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
      .reverse()
      .first();

    const now = Date.now();
    let tfDuration = (timeframe === Timeframe.D1) ? 86400000 : (timeframe === Timeframe.H4 ? 14400000 : 3600000);

    // 1. Throttling Check (Priority High)
    // If we synced successfully within the last 5 minutes (or 1h for Daily), DO NOT sync again,
    // even if the data looks old (could be holiday, weekend, or delisted).
    if (status) {
      const lastSync = new Date(status.lastSync).getTime();
      const throttleThreshold = (timeframe === Timeframe.D1) ? 3600000 : 300000; // D1: 1hr, others: 5m

      if (now - lastSync < throttleThreshold) {
        // console.log(`⏸️  Sync Throttled for ${syncId}. Recently synced.`);
        const cached = await db.bars
          .where('[ticker+timeframe+time]')
          .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
          .toArray();
        return cached.sort((a, b) => a.time.localeCompare(b.time));
      }
    }

    // 2. Staleness / Force Check
    // Now we know we haven't synced recently. Check if we need to.

    // Staleness Guard: If data is older than 1.5 periods, it is "Stale"
    const lastBarTime = latestBar ? new Date(latestBar.time).getTime() : 0;
    const isStale = !latestBar || (now - lastBarTime > tfDuration * 1.5);

    // CRITICAL FIX: Validate that lastBarTime is not in the future
    if (latestBar && lastBarTime > now) {
      console.warn(`⚠️  Found future-dated bar for ${syncId}: ${latestBar.time}. Clearing corrupted data.`);
      // Delete future-dated bars
      await db.bars
        .where('[ticker+timeframe+time]')
        .between([normalizedTicker, timeframe, new Date(now).toISOString()], [normalizedTicker, timeframe, "\uffff"])
        .delete();
      // Force a fresh sync
      shouldForceSync = true;
    }

    // CRITICAL FIX: Always sync if data is stale (missing recent data) to fill gaps from last sync to current
    // This ensures we always fetch missing data from last sync till current market data
    if (isStale) {
      const staleAge = latestBar ? Math.round((now - lastBarTime) / (1000 * 60 * 60)) : 0;
      console.log(`🔄 Data is stale for ${syncId} (${staleAge}h old). Syncing to fill gap from last sync to current.`);
      // Continue to sync logic - don't return cached data
    } else if (status && !isStale && latestBar) {
      // Data appears fresh - do a lightweight check to see if there's actually new data
      // Only do this check if we have existing data AND it's low priority (background scanner)
      // For manual high priority syncs, we trust the cache more or force it explicitly
      if (priority === Priority.HIGH) {
        const cached = await db.bars
          .where('[ticker+timeframe+time]')
          .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
          .toArray();
        return cached.sort((a, b) => a.time.localeCompare(b.time));
      }

      const latestApiBarTime = await checkForUpdates(normalizedTicker, timeframe, priority);
      const latestBarTime = new Date(latestBar.time).getTime();

      if (latestApiBarTime) {
        const apiBarTime = new Date(latestApiBarTime).getTime();
        // Only sync if API has newer data than what we have (with 1 minute tolerance for timing differences)
        const timeDiff = apiBarTime - latestBarTime;
        if (timeDiff > 60000) { // More than 1 minute newer
          const ageDiff = Math.round(timeDiff / (1000 * 60 * 60));
          console.log(`🔄 New data available for ${syncId} (${ageDiff}h newer). Syncing updates.`);
          // Continue to sync logic
        } else {
          // No new data available, return cached
          console.log(`✅ No updates available for ${syncId}. Using cached data.`);
          const cached = await db.bars
            .where('[ticker+timeframe+time]')
            .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
            .toArray();
          // Update sync status to reflect we checked (but don't change the actual sync time)
          await db.syncStatus.put({ id: syncId, lastSync: status.lastSync });
          return cached.sort((a, b) => a.time.localeCompare(b.time));
        }
      } else {
        // Check failed - assume no updates and return cached (checkForUpdates already logged the warning)
        console.log(`✅ Update check inconclusive for ${syncId}. Using cached data.`);
        const cached = await db.bars
          .where('[ticker+timeframe+time]')
          .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
          .toArray();
        return cached.sort((a, b) => a.time.localeCompare(b.time));
      }
    } else if (status && !isStale && !latestBar) {
      // No data in cache but status exists - should sync
      console.log(`🔄 No cached data for ${syncId} but status exists. Syncing.`);
      // Continue to sync logic
    }
  }


  // 2. Identify starting point
  let fromDate: string;

  if (shouldForceSync) {
    // Force mode: Get 6 months of data
    fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await db.bars.where('[ticker+timeframe+time]').between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"]).delete();
  } else {
    // Re-fetch lastBar after potential cleanup to ensure we have valid data
    const lastBar = await db.bars
      .where('[ticker+timeframe+time]')
      .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
      .reverse()
      .first();

    if (lastBar) {
      // Continue from last bar with 1 day overlap to ensure we fill any gaps
      // This ensures we fetch missing data from last sync till current market data
      const d = new Date(lastBar.time);
      const now = Date.now();
      // CRITICAL FIX: Ensure date is not in the future
      if (d.getTime() > now) {
        console.warn(`⚠️  Last bar has future date for ${syncId}: ${lastBar.time}. Using current date instead.`);
        d.setTime(now);
        // If we found a future date, force a fresh sync from 6 months ago
        fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      } else {
        // Start 1 day before last bar to ensure overlap and fill any gaps
        d.setDate(d.getDate() - 1);
        fromDate = d.toISOString().split('T')[0];
      }
    } else {
      // First sync: Get last 6 months of historical data
      fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
  }

  // Always sync up to current date to ensure we have the most recent market data
  const toDate = new Date().toISOString().split('T')[0];

  // CRITICAL FIX: Validate date range
  if (fromDate > toDate) {
    console.error(`❌ Invalid date range for ${syncId}: ${fromDate} > ${toDate}. Resetting.`);
    fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }
  let multiplier = 1;
  let timespan = 'day';
  if (timeframe === Timeframe.H4) { multiplier = 4; timespan = 'hour'; }
  else if (timeframe === Timeframe.H1) { multiplier = 1; timespan = 'hour'; }

  console.log(`📊 Starting sync loop for ${syncId} from ${fromDate} to ${toDate}`);

  let currentStart = fromDate;
  let hasMore = true;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  while (hasMore) {
    if (currentStart > toDate) break;

    const isCrypto = normalizedTicker.startsWith('X:');
    let url: string;

    if (isCrypto) {
      const binanceSymbol = normalizedTicker.replace('X:', '');
      let interval = '1d';
      if (timeframe === Timeframe.H4) interval = '4h';
      else if (timeframe === Timeframe.H1) interval = '1h';

      const startTime = new Date(currentStart).getTime();
      const endTime = new Date(toDate).getTime() + 86399999;
      url = `${activeBinanceBaseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    } else {
      url = `${BASE_URL}/${normalizedTicker}/range/${multiplier}/${timespan}/${currentStart}/${toDate}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;
    }

    try {
      console.log(`🔍 Fetching ${syncId} from ${isCrypto ? 'Binance' : 'Polygon'} starting ${currentStart}...`);
      const data = await (isCrypto ? fetch(url).then(r => r.json()) : queuedFetch(url, priority));

      // Reset error counter on success
      consecutiveErrors = 0;

      // Normalize Binance data
      const results = isCrypto
        ? (Array.isArray(data) ? data.map((k: any) => ({
          t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5])
        })) : [])
        : (data?.results || []);

      if (results.length > 0) {
        console.log(`📥 Received ${results.length} bars for ${syncId}`);

        // Filter out future-dated bars
        const now = Date.now();
        const validBars = results.filter((r: any) => r.t <= now);

        if (validBars.length === 0) {
          hasMore = false;
          continue;
        }

        const newBars: BarRecord[] = validBars.map((r: any) => ({
          ticker: normalizedTicker,
          timeframe,
          time: new Date(r.t).toISOString(),
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));

        await db.bars.bulkPut(newBars);

        const lastT = validBars[validBars.length - 1].t;
        const lastDate = new Date(lastT).toISOString().split('T')[0];

        if (lastDate >= toDate || results.length < (isCrypto ? 1000 : 4750)) {
          hasMore = false;
        } else {
          const next = new Date(lastT);
          next.setMinutes(next.getMinutes() + 1); // Advance by 1 minute
          currentStart = next.toISOString().split('T')[0];
        }
      } else {
        hasMore = false;
      }
    } catch (e: any) {
      consecutiveErrors++;
      console.error(`❌ Sync loop error for ${syncId} (${consecutiveErrors}/${maxConsecutiveErrors}):`, e.message || e);

      // CRITICAL FIX: Stop after too many consecutive errors to prevent infinite loops
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(`❌ Too many consecutive errors for ${syncId}. Stopping sync.`);
        hasMore = false;
        break;
      }

      // For client errors (403, 404), don't retry - just stop
      if (e.message && e.message.includes('API Error 4')) {
        console.error(`❌ Client error for ${syncId}. Stopping sync.`);
        hasMore = false;
        break;
      }

      // For other errors, wait a bit and try to advance
      await new Promise(r => setTimeout(r, 2000));
      const nextStart = new Date(currentStart);
      nextStart.setDate(nextStart.getDate() + 1);
      currentStart = nextStart.toISOString().split('T')[0];
      if (currentStart > toDate) hasMore = false;
    }
  }

  // Only update sync status if we actually reached the current date range
  const checkLastBar = await db.bars
    .where('[ticker+timeframe+time]')
    .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
    .reverse()
    .first();

  // CRITICAL FIX: Use timeframe-appropriate staleness check
  // Account for market hours - crypto markets are 24/7, but data might lag
  const now = Date.now();
  const isCrypto = normalizedTicker.startsWith('X:');
  let stalenessThreshold = 86400000 * 2; // 2 days default
  if (timeframe === Timeframe.H1) {
    stalenessThreshold = isCrypto ? 6 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 6h for crypto, 2h for stocks
  } else if (timeframe === Timeframe.H4) {
    stalenessThreshold = isCrypto ? 12 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000; // 12h for crypto, 8h for stocks
  }

  const isCurrent = checkLastBar && (now - new Date(checkLastBar.time).getTime() < stalenessThreshold);
  if (isCurrent) {
    await db.syncStatus.put({ id: syncId, lastSync: new Date().toISOString() });
    console.log(`✅ Sync completed for ${syncId} - now current`);
  } else if (checkLastBar) {
    const lastBarAge = Math.round((now - new Date(checkLastBar.time).getTime()) / (1000 * 60 * 60));
    // Only warn if data is significantly old (more than 24h for hourly, 48h for 4h, 3 days for daily)
    const warningThreshold = timeframe === Timeframe.H1 ? 24 : (timeframe === Timeframe.H4 ? 48 : 72);
    if (lastBarAge > warningThreshold) {
      console.warn(`⚠️  Sync finished for ${syncId} but data still appears old (last bar is ${lastBarAge}h old)`);
    } else {
      // Data is reasonably fresh, just not "current" - this is normal for markets that close or have delays
      console.log(`✅ Sync completed for ${syncId} - data is ${lastBarAge}h old (acceptable)`);
      await db.syncStatus.put({ id: syncId, lastSync: new Date().toISOString() });
    }
  } else {
    console.log(`⚠️  Sync finished for ${syncId} but no data was saved`);
  }

  const final = await db.bars
    .where('[ticker+timeframe+time]')
    .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
    .toArray();

  return final.sort((a, b) => a.time.localeCompare(b.time));
};

/**
 * Limit concurrent calls to sync ticker data
 */
export const syncTickerData = async (ticker: string, timeframe: Timeframe, force: boolean = false, priority: Priority = Priority.LOW): Promise<OhlcvData[]> => {
  const normalizedTicker = normalizeTicker(ticker);
  const syncId = `${normalizedTicker}:${timeframe}`;

  if (pendingSyncs.has(syncId)) {
    console.log(`⚡️ Joining existing sync for ${syncId}`);
    return pendingSyncs.get(syncId)!;
  }

  const promise = performSync(ticker, timeframe, force, priority)
    .finally(() => {
      pendingSyncs.delete(syncId);
    });

  pendingSyncs.set(syncId, promise);
  return promise;
};

/**
 * Returns cached data immediately for optimistic UI
 */
export const getCachedTickerData = async (symbol: string): Promise<TickerData> => {
  const normalizedTicker = normalizeTicker(symbol);
  const fetchCachedTF = async (tf: Timeframe) => {
    const bars = await db.bars.where('[ticker+timeframe+time]').between([normalizedTicker, tf, ""], [normalizedTicker, tf, "\uffff"]).toArray();
    return processIndicators(bars.sort((a, b) => a.time.localeCompare(b.time)));
  };

  const data = {
    [Timeframe.D1]: await fetchCachedTF(Timeframe.D1),
    [Timeframe.H4]: await fetchCachedTF(Timeframe.H4),
    [Timeframe.H1]: await fetchCachedTF(Timeframe.H1),
  };

  return {
    symbol,
    data,
    livePrice: data[Timeframe.H1].length > 0 ? data[Timeframe.H1][data[Timeframe.H1].length - 1].close : 0
  };
};

/**
 * Technical Indicator Logic
 */
const processIndicators = (ohlcv: OhlcvData[]): IndicatorData[] => {
  if (ohlcv.length === 0) return [];

  // O(N) uniqueness check: Assumes data is already sorted by time
  const uniqueBars: OhlcvData[] = [];
  if (ohlcv.length > 0) {
    uniqueBars.push(ohlcv[0]);
    for (let i = 1; i < ohlcv.length; i++) {
      if (ohlcv[i].time !== ohlcv[i - 1].time) {
        uniqueBars.push(ohlcv[i]);
      }
    }
  }

  const prices = uniqueBars.map(d => d.close);
  const ema20 = calculateEMA(prices, 20);
  const rsi = calculateRSI(prices, 14);
  const { macdLine, signalLine, histogram } = calculateMACD(prices);

  return uniqueBars.map((d, i) => ({
    ...d,
    ema: ema20[i],
    rsi: rsi[i],
    macd: macdLine[i],
    macdSignal: signalLine[i],
    macdHist: histogram[i]
  }));
};

/**
 * Snapshot (Live Price) Logic
 */
const fetchLatestPrice = async (ticker: string, priority: Priority = Priority.LOW): Promise<Partial<OhlcvData> | null> => {
  const normalizedTicker = normalizeTicker(ticker);
  const isCrypto = normalizedTicker.startsWith('X:');
  const endpoint = isCrypto
    ? `https://api.polygon.io/v2/snapshot/locale/global/markets/crypto/tickers/${normalizedTicker}`
    : `https://api.polygon.io/v2/snapshot/locale/us/stocks/tickers/${normalizedTicker}`;

  try {
    if (isCrypto) {
      const binanceSymbol = normalizedTicker.replace('X:', '');
      const url = `${activeBinanceBaseUrl}/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
      const data = await fetch(url).then(r => r.json());

      if (data && data.lastPrice) {
        const price = parseFloat(data.lastPrice);
        return {
          time: new Date().toISOString(),
          close: price,
          high: parseFloat(data.highPrice),
          low: parseFloat(data.lowPrice),
          open: parseFloat(data.openPrice),
          volume: parseFloat(data.volume)
        };
      }
    } else {
      const data = await queuedFetch(`${endpoint}?apiKey=${POLYGON_API_KEY}`, priority);
      if (data && data.ticker) {
        const t = data.ticker;
        const price = t.lastTrade?.p || t.prevDay?.c || t.day?.c;

        if (price) {
          return {
            time: new Date().toISOString(),
            close: price,
            high: Math.max(price, t.day?.h || price),
            low: Math.min(price, t.day?.l || price),
            open: t.day?.o || price,
            volume: t.day?.v || 0
          };
        }
      }
    }
  } catch (e: any) {
    // CRITICAL FIX: Silently handle 403/404 errors for snapshot endpoints
    // 403 = Not authorized (plan limitation - some crypto tickers require higher plan)
    // 404 = Not found (ticker doesn't exist or doesn't have snapshot data)
    if (e.message && (e.message.includes('API Error 403') || e.message.includes('API Error 404'))) {
      // Silently handle these - they're expected for some tickers
      return null;
    }
    console.warn(`Snapshot fetch failed for ${ticker}:`, e.message || e);
  }
  return null;
};

/**
 * Public Data Interface
 */
export const fetchTickerData = async (symbol: string, force: boolean = false, priorityLevel: 'HIGH' | 'LOW' = 'LOW'): Promise<TickerData> => {
  const p = priorityLevel === 'HIGH' ? Priority.HIGH : Priority.LOW;

  // OPTIMIZED: Parallel execution for paid accounts
  const [d1Data, h4Data, h1Data, liveSnapshot] = await Promise.all([
    syncTickerData(symbol, Timeframe.D1, force, p),
    syncTickerData(symbol, Timeframe.H4, force, p),
    syncTickerData(symbol, Timeframe.H1, force, p),
    fetchLatestPrice(symbol, p).catch(e => {
      console.warn(`Snapshot fetch failed for ${symbol}, continuing with cached data:`, e.message);
      return null;
    })
  ]);

  // 2. Strict Price Unification Policy
  // Check if all timeframes are within their expected range of "Now"
  const now = Date.now();
  const d1Stale = d1Data.length === 0 || (now - new Date(d1Data[d1Data.length - 1].time).getTime() > 86400000 * 2);
  const h4Stale = h4Data.length === 0 || (now - new Date(h4Data[h4Data.length - 1].time).getTime() > 14400000 * 2);
  const h1Stale = h1Data.length === 0 || (now - new Date(h1Data[h1Data.length - 1].time).getTime() > 60 * 60 * 1000 * 2);

  const anyStale = d1Stale || h4Stale || h1Stale;

  const patchSeries = (series: OhlcvData[], tf: Timeframe): OhlcvData[] => {
    // If any timeframe is stale OR we have no snapshot, we DO NOT patch.
    // This maintains perfect 1:1 parity between the header price and all chart labels.
    if (!liveSnapshot || series.length === 0 || anyStale) return series;

    const lastBar = series[series.length - 1];
    const snapshotTime = new Date(liveSnapshot.time!).getTime();
    const lastBarTime = new Date(lastBar.time).getTime();

    let tfDuration = 24 * 60 * 60 * 1000;
    if (tf === Timeframe.H4) tfDuration = 4 * 60 * 60 * 1000;
    else if (tf === Timeframe.H1) tfDuration = 1 * 60 * 60 * 1000;

    const timeSinceLast = snapshotTime - lastBarTime;

    if (timeSinceLast < tfDuration * 1.5) {
      const updated = [...series];
      const last = updated.length - 1;
      updated[last] = {
        ...updated[last],
        close: liveSnapshot.close!,
        high: Math.max(updated[last].high, liveSnapshot.high || liveSnapshot.close!),
        low: Math.min(updated[last].low, liveSnapshot.low || liveSnapshot.close!),
      };
      return updated;
    } else if (timeSinceLast < tfDuration * 2.5) {
      return [...series, {
        time: new Date(lastBarTime + tfDuration).toISOString(),
        open: liveSnapshot.open || liveSnapshot.close!,
        high: liveSnapshot.high || liveSnapshot.close!,
        low: liveSnapshot.low || liveSnapshot.close!,
        close: liveSnapshot.close!,
        volume: liveSnapshot.volume || 0
      }];
    }
    return series;
  };

  return {
    symbol,
    livePrice: liveSnapshot?.close || (h1Data.length > 0 ? h1Data[h1Data.length - 1].close : 0),
    syncStatus: {
      [Timeframe.D1]: !d1Stale,
      [Timeframe.H4]: !h4Stale,
      [Timeframe.H1]: !h1Stale,
    },
    data: {
      [Timeframe.D1]: processIndicators(patchSeries(d1Data, Timeframe.D1)),
      [Timeframe.H4]: processIndicators(patchSeries(h4Data, Timeframe.H4)),
      [Timeframe.H1]: processIndicators(patchSeries(h1Data, Timeframe.H1)),
    }
  };
};

/**
 * Market Scanner Logic - Consolidated by Ticker
 */
export const scanMarket = async (customTickers?: string[]): Promise<ConsolidatedAlert[]> => {
  const tickerMap: Record<string, ConsolidatedAlert> = {};
  const tickers = customTickers || TICKERS;

  for (const ticker of tickers) {
    try {
      const tickerData = await getCachedTickerData(ticker);
      const signals: ConsolidatedAlert['signals'] = [];
      let latestPrice = 0;

      for (const tf of [Timeframe.D1, Timeframe.H4, Timeframe.H1]) {
        const series = tickerData.data[tf as Timeframe];
        if (!series || series.length < 50) continue;

        latestPrice = series[series.length - 1].close;

        const rsiDiv = scanForDivergences(series, IndicatorType.RSI);
        if (rsiDiv) {
          signals.push({
            timeframe: tf as Timeframe,
            signalType: rsiDiv.type,
            indicator: IndicatorType.RSI,
            description: rsiDiv.description
          });
        }

        const macdDiv = scanForDivergences(series, IndicatorType.MACD);
        if (macdDiv) {
          signals.push({
            timeframe: tf as Timeframe,
            signalType: macdDiv.type,
            indicator: IndicatorType.MACD,
            description: macdDiv.description
          });
        }
      }

      if (signals.length > 0) {
        tickerMap[ticker] = {
          ticker,
          signals,
          price: latestPrice,
          timestamp: new Date().toISOString()
        };
      }
    } catch (e) {
      console.error(`Scan error for ${ticker}:`, e);
    }
  }

  return Object.values(tickerMap).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};