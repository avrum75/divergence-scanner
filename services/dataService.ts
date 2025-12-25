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
  private minInterval = 250; // Paid tier allows much higher rate. Using 250ms (4 req/sec). Only use 13000 for FREE tier.
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
      const now = Date.now();
      const timeSinceLast = now - this.lastCallTime;

      if (timeSinceLast < this.minInterval) {
        await new Promise(res => setTimeout(res, this.minInterval - timeSinceLast));
      }

      const item = this.queue.shift();
      if (!item) break;

      this.lastCallTime = Date.now();
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
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
    console.log(`Queued API call: ${url.split('apiKey=')[0]}...`);
    const resp = await fetch(url);
    if (resp.status === 429) {
      console.warn("429 Rate Limit! Waiting extra 30s...");
      await new Promise(r => setTimeout(r, 30000));
      // Re-queue it (though the class handles internal timing, 429 means we should back off even more)
      return queuedFetch(url, priority);
    }
    return resp.json();
  }, priority);
};

// --- Data Normalization ---

const normalizeTicker = (ticker: string): string => {
  const crypto = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'DOGE', 'MATIC', 'POL'];
  const cleanTicker = ticker.toUpperCase().trim();
  if (crypto.includes(cleanTicker)) {
    return `X:${cleanTicker}USD`;
  }
  return cleanTicker;
};

// --- Core Sync Logic ---

/**
 * Fetches data from Polygon and caches it in IndexedDB
 */
const syncTickerData = async (ticker: string, timeframe: Timeframe, force: boolean = false, priority: Priority = Priority.LOW): Promise<OhlcvData[]> => {
  const normalizedTicker = normalizeTicker(ticker);
  const syncId = `${normalizedTicker}:${timeframe}`;

  // 1. Check if we actually need to sync (Throttling)
  if (!force) {
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

    // Absolute Cutoff: If data is older than 24 hours AND we haven't synced recently (checked above),
    // we should force a sync.
    const isActuallyOld = !latestBar || (now - lastBarTime > 86400000);

    if (isActuallyOld && status) {
      console.log(`🔄 Auto-forcing sync for ${syncId} - data is ${Math.round((now - lastBarTime) / 86400000)} days old`);
      // We don't need to delete status, just let it proceed. The save at end will update timestamp.
    } else if (status && !isStale) {
      // Data is fresh enough and we possess a status -> return cached
      const cached = await db.bars
        .where('[ticker+timeframe+time]')
        .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
        .toArray();
      return cached.sort((a, b) => a.time.localeCompare(b.time));
    }
  }


  // 2. Identify starting point
  let fromDate: string;

  if (force) {
    // Force mode: Get 6 months of data
    fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await db.bars.where('[ticker+timeframe+time]').between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"]).delete();
  } else {
    const lastBar = await db.bars
      .where('[ticker+timeframe+time]')
      .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
      .reverse()
      .first();

    if (lastBar) {
      // Continue from last bar with 1 day overlap
      const d = new Date(lastBar.time);
      d.setDate(d.getDate() - 1);
      fromDate = d.toISOString().split('T')[0];
    } else {
      // First sync: Only get last 3 months
      fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
  }

  const toDate = new Date().toISOString().split('T')[0];
  let multiplier = 1;
  let timespan = 'day';
  if (timeframe === Timeframe.H4) { multiplier = 4; timespan = 'hour'; }
  else if (timeframe === Timeframe.H1) { multiplier = 1; timespan = 'hour'; }

  console.log(`📊 Starting sync loop for ${syncId} from ${fromDate} to ${toDate}`);

  let currentStart = fromDate;
  let hasMore = true;

  while (hasMore) {
    if (currentStart > toDate) break;

    const url = `${BASE_URL}/${normalizedTicker}/range/${multiplier}/${timespan}/${currentStart}/${toDate}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;

    try {
      console.log(`🔍 Fetching ${syncId} from ${currentStart}...`);
      const data = await queuedFetch(url, priority);
      if (data && data.results && data.results.length > 0) {
        console.log(`📥 Received ${data.results.length} bars for ${syncId}`);
        const newBars: BarRecord[] = data.results.map((r: any) => ({
          ticker: normalizedTicker,
          timeframe,
          time: new Date(r.t).toISOString(),
          open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
        }));

        await db.bars.bulkPut(newBars);

        // ADVANCE logic: We always advance by at least 1 day from the last bar received
        const lastT = data.results[data.results.length - 1].t;
        const lastDate = new Date(lastT).toISOString().split('T')[0];

        if (lastDate === currentStart) {
          // If the last bar is on the SAME day as currentStart, we must increment currentStart
          // to avoid hitting the same window again.
          const next = new Date(lastT);
          next.setDate(next.getDate() + 1);
          currentStart = next.toISOString().split('T')[0];
        } else {
          // CRITICAL FIX: Always advance past the last bar to avoid infinite loop
          const next = new Date(lastT);
          next.setDate(next.getDate() + 1);
          currentStart = next.toISOString().split('T')[0];
        }

        // If we reach "Today" or the batch was less than limit (with safety margin), we stop.
        if (currentStart >= toDate || data.results.length < 4750) {
          console.log(`🎯 Sync finished for ${syncId} (reached target or < limit)`);
          hasMore = false;
        }
      } else {
        // GAP LEAPFROG: If no data returned, advance by a week to skip holidays/thin data
        const nextStart = new Date(currentStart);
        nextStart.setDate(nextStart.getDate() + 7);
        currentStart = nextStart.toISOString().split('T')[0];

        console.log(`⏭️  Leapfrogging gap for ${syncId}. New start: ${currentStart}`);
        if (currentStart > toDate) hasMore = false;
      }
    } catch (e) {
      console.error(`❌ Sync loop error for ${syncId}:`, e);
      hasMore = false;
    }
  }

  // Only update sync status if we actually reached the current date range
  const checkLastBar = await db.bars
    .where('[ticker+timeframe+time]')
    .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
    .reverse()
    .first();

  const isCurrent = checkLastBar && (Date.now() - new Date(checkLastBar.time).getTime() < 86400000 * 2);
  if (isCurrent) {
    await db.syncStatus.put({ id: syncId, lastSync: new Date().toISOString() });
    console.log(`✅ Sync completed for ${syncId} - now current`);
  } else {
    console.log(`⚠️  Sync finished for ${syncId} but data still appears old`);
  }

  const final = await db.bars
    .where('[ticker+timeframe+time]')
    .between([normalizedTicker, timeframe, ""], [normalizedTicker, timeframe, "\uffff"])
    .toArray();

  return final.sort((a, b) => a.time.localeCompare(b.time));
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
  const uniqueBars = ohlcv.filter((v, i, a) => a.findIndex(t => t.time === v.time) === i);
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
    const data = await queuedFetch(`${endpoint}?apiKey=${POLYGON_API_KEY}`, priority);
    if (data && data.ticker) {
      const t = data.ticker;
      // US Stocks: prioritize lastTrade price, fall back to prevDay.c
      // Crypto: prioritize lastTrade price
      const price = isCrypto
        ? (t.lastTrade?.p || t.day?.c)
        : (t.lastTrade?.p || t.prevDay?.c || t.day?.c);

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
  } catch (e) {
    console.error(`Snapshot fetch failed for ${ticker}:`, e);
  }
  return null;
};

/**
 * Public Data Interface
 */
export const fetchTickerData = async (symbol: string, force: boolean = false, priorityLevel: 'HIGH' | 'LOW' = 'LOW'): Promise<TickerData> => {
  const p = priorityLevel === 'HIGH' ? Priority.HIGH : Priority.LOW;

  // 1. Concurrent Sync (They go into the queue and sort by priority)
  const [d1Data, h4Data, h1Data, liveSnapshot] = await Promise.all([
    syncTickerData(symbol, Timeframe.D1, force, p),
    syncTickerData(symbol, Timeframe.H4, force, p),
    syncTickerData(symbol, Timeframe.H1, force, p),
    fetchLatestPrice(symbol, p)
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