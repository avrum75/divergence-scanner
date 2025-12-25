import { IndicatorData, SignalType, IndicatorType } from '../types';

/**
 * Calculates Simple Moving Average
 */
const calculateSMA = (data: number[], window: number): number[] => {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) {
      sma.push(NaN);
      continue;
    }
    const slice = data.slice(i - window + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    sma.push(sum / window);
  }
  return sma;
};

/**
 * Calculates Exponential Moving Average
 */
export const calculateEMA = (data: number[], window: number): number[] => {
  const k = 2 / (window + 1);
  const ema: number[] = [data[0]]; // Start with first price point
  for (let i = 1; i < data.length; i++) {
    const val = data[i] * k + ema[i - 1] * (1 - k);
    ema.push(val);
  }
  return ema;
};

/**
 * Calculates RSI (Relative Strength Index)
 */
export const calculateRSI = (closePrices: number[], period: number = 14): number[] => {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closePrices.length; i++) {
    const change = closePrices[i] - closePrices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Initial Average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // First RSI
  rsi.push(NaN); // Pad for 0 index
  for(let i=1; i < period; i++) rsi.push(NaN); // Pad for initial period

  let rs = avgGain / avgLoss;
  rsi.push(100 - (100 / (1 + rs)));

  // Smoothed calculation
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }

  return rsi;
};

/**
 * Calculates MACD
 */
export const calculateMACD = (closePrices: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
  const emaFast = calculateEMA(closePrices, fast);
  const emaSlow = calculateEMA(closePrices, slow);
  
  const macdLine: number[] = [];
  for (let i = 0; i < closePrices.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  const signalLine = calculateEMA(macdLine, signal);
  const histogram: number[] = [];

  for (let i = 0; i < macdLine.length; i++) {
    histogram.push(macdLine[i] - signalLine[i]);
  }

  return { macdLine, signalLine, histogram };
};

/**
 * Finds local peaks and valleys
 */
const findPivots = (values: number[], type: 'high' | 'low', range: number = 5): number[] => {
  const pivots: number[] = [];
  // Ensure we have enough data and respect the range check
  for (let i = range; i < values.length - range; i++) {
    const val = values[i];
    if (isNaN(val)) continue;

    let isPivot = true;
    for (let j = 1; j <= range; j++) {
      if (type === 'high') {
        if (values[i - j] > val || values[i + j] >= val) { // Strict inequality on left, weak on right to handle flats slightly
          isPivot = false;
          break;
        }
      } else {
        if (values[i - j] < val || values[i + j] <= val) {
          isPivot = false;
          break;
        }
      }
    }
    if (isPivot) pivots.push(i);
  }
  return pivots;
};

/**
 * SCANS for Divergences
 * Logic:
 * Bullish: Price LL (Lower Low) + Indicator HL (Higher Low)
 * Bearish: Price HH (Higher High) + Indicator LH (Lower High)
 */
export const scanForDivergences = (
  candles: IndicatorData[],
  indicatorType: IndicatorType
): { type: SignalType, description: string } | null => {
  
  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  // Use last 100 candles for scan
  const lookback = 100;
  const recentCloses = closes.slice(-lookback);
  const offset = closes.length - lookback;
  
  let indicatorValues: number[] = [];
  if (indicatorType === IndicatorType.RSI) {
    indicatorValues = candles.map(c => c.rsi || 0).slice(-lookback);
  } else {
    // For MACD, we usually look for divergence in Histogram or Line. Using Histogram is common for momentum.
    indicatorValues = candles.map(c => c.macdHist || 0).slice(-lookback);
  }

  // 1. Detect Bullish Divergence (Compare Lows)
  // Find price valleys
  const priceLows = findPivots(recentCloses, 'low', 3);
  const indicatorLows = findPivots(indicatorValues, 'low', 3);

  // We need the last two pivots
  if (priceLows.length >= 2 && indicatorLows.length >= 2) {
    const lastPriceIdx = priceLows[priceLows.length - 1];
    const prevPriceIdx = priceLows[priceLows.length - 2];
    
    // Find corresponding indicator lows that are close in time (within some margin of error, say 3 candles)
    // Simplified: We assume pivots roughly align. In a real engine, we'd match timestamps.
    // For this demo, we check if the indicator ALSO has pivots near these indices.
    
    // Check strict Divergence Definition:
    // Price[Last] < Price[Prev] AND Indicator[Last] > Indicator[Prev]
    
    if (recentCloses[lastPriceIdx] < recentCloses[prevPriceIdx]) {
       // Check if we have indicator lows roughly aligned
       const lastIndIdx = indicatorLows.find(idx => Math.abs(idx - lastPriceIdx) <= 3);
       const prevIndIdx = indicatorLows.find(idx => Math.abs(idx - prevPriceIdx) <= 3);

       if (lastIndIdx !== undefined && prevIndIdx !== undefined) {
         if (indicatorValues[lastIndIdx] > indicatorValues[prevIndIdx]) {
           return {
             type: SignalType.BULLISH_DIVERGENCE,
             description: `Price made Lower Low ($${recentCloses[lastPriceIdx].toFixed(2)}) while ${indicatorType} made Higher Low (${indicatorValues[lastIndIdx].toFixed(2)})`
           };
         }
       }
    }
  }

  // 2. Detect Bearish Divergence (Compare Highs)
  const priceHighs = findPivots(recentCloses, 'high', 3);
  const indicatorHighs = findPivots(indicatorValues, 'high', 3);

  if (priceHighs.length >= 2 && indicatorHighs.length >= 2) {
    const lastPriceIdx = priceHighs[priceHighs.length - 1];
    const prevPriceIdx = priceHighs[priceHighs.length - 2];

    if (recentCloses[lastPriceIdx] > recentCloses[prevPriceIdx]) {
       const lastIndIdx = indicatorHighs.find(idx => Math.abs(idx - lastPriceIdx) <= 3);
       const prevIndIdx = indicatorHighs.find(idx => Math.abs(idx - prevPriceIdx) <= 3);

       if (lastIndIdx !== undefined && prevIndIdx !== undefined) {
         if (indicatorValues[lastIndIdx] < indicatorValues[prevIndIdx]) {
           return {
             type: SignalType.BEARISH_DIVERGENCE,
             description: `Price made Higher High ($${recentCloses[lastPriceIdx].toFixed(2)}) while ${indicatorType} made Lower High (${indicatorValues[lastIndIdx].toFixed(2)})`
           };
         }
       }
    }
  }

  return null;
};
