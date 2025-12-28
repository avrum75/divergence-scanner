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
  for (let i = 1; i < period; i++) rsi.push(NaN); // Pad for initial period

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
/**
 * SCANS for Divergences (Regular and Hidden)
 */
export const scanForDivergences = (
  candles: IndicatorData[],
  indicatorType: IndicatorType,
  sensitivity: number = 3 // 3 = FAST, 5 = SLOW
): any | null => {

  if (candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const lookback = 120; // Slightly larger lookback for multi-pivots
  const recentCloses = closes.slice(-lookback);

  let indicatorValues: number[] = [];
  if (indicatorType === IndicatorType.RSI) {
    indicatorValues = candles.map(c => c.rsi || 0).slice(-lookback);
  } else {
    indicatorValues = candles.map(c => c.macdHist || 0).slice(-lookback);
  }

  const findSignals = (type: 'bullish' | 'bearish') => {
    const isBullish = type === 'bullish';
    const pricePivots = findPivots(recentCloses, isBullish ? 'low' : 'high', sensitivity);
    const indPivots = findPivots(indicatorValues, isBullish ? 'low' : 'high', sensitivity);

    if (pricePivots.length < 2 || indPivots.length < 2) return null;

    // Use the last 3 pivots if available for Triple Divergence detection
    const pIndices = pricePivots.slice(-3);
    const iIndices = indPivots.slice(-3);

    // Check pivots for matching pairs (price pivot near indicator pivot)
    const matchedPairs: { p: number, i: number }[] = [];
    for (const p of pIndices) {
      const match = iIndices.find(idx => Math.abs(idx - p) <= 4);
      if (match !== undefined) matchedPairs.push({ p, i: match });
    }

    if (matchedPairs.length < 2) return null;

    const last = matchedPairs[matchedPairs.length - 1];
    const prev = matchedPairs[matchedPairs.length - 2];
    const triple = matchedPairs.length >= 3 ? matchedPairs[matchedPairs.length - 3] : null;

    // REGULAR DIVERGENCE (Reversal)
    // Bullish: Price LL, Indicator HL
    // Bearish: Price HH, Indicator LH
    const isRegular = isBullish
      ? (recentCloses[last.p] < recentCloses[prev.p] && indicatorValues[last.i] > indicatorValues[prev.i])
      : (recentCloses[last.p] > recentCloses[prev.p] && indicatorValues[last.i] < indicatorValues[prev.i]);

    // HIDDEN DIVERGENCE (Trend Continuation)
    const isHidden = isBullish
      ? (recentCloses[last.p] > recentCloses[prev.p] && indicatorValues[last.i] < indicatorValues[prev.i])
      : (recentCloses[last.p] < recentCloses[prev.p] && indicatorValues[last.i] > indicatorValues[prev.i]);

    if (!isRegular && !isHidden) return null;

    // FRESHNESS CHECK (Max Age)
    // last.p is index in recentCloses (length 120)
    const lastPivotAge = (recentCloses.length - 1) - last.p;
    const isStale = lastPivotAge > 10;

    // TREND DETECTION (Macro)
    // Simply compare current price vs EMA or a longer window SMA
    const macroTrendWindow = 50;
    const macroTrendSma = calculateEMA(closes, macroTrendWindow);
    const currentPrice = closes[closes.length - 1];
    const currentSma = macroTrendSma[macroTrendSma.length - 1];
    const isUpTrend = currentPrice > currentSma;

    // Signal is trend aligned if:
    // Bullish Hidden: Uptrend (Continuation)
    // Bullish Regular: Downtrend (Potential Reversal) - wait, or just "Counter trend"
    // For simplicity:
    // Hidden signals MUST be trend-aligned.
    // Regular signals are often counter-trend (reversals).
    const isTrendAligned = isHidden
      ? (isBullish ? isUpTrend : !isUpTrend)
      : true; // Regular divergences are reversals, so they don't have to be trend-aligned in the same way

    // Strength Calculation (0-100)
    // Based on the "width" of the divergence and divergence of slopes
    const priceDelta = Math.abs(recentCloses[last.p] - recentCloses[prev.p]) / recentCloses[prev.p];
    const indDelta = Math.abs(indicatorValues[last.i] - indicatorValues[prev.i]);
    const timeDelta = last.p - prev.p;

    let strength = 50; // Base strength
    strength += Math.min(priceDelta * 1000, 20); // More price movement = stronger
    strength += Math.min(indDelta / (indicatorType === IndicatorType.RSI ? 0.5 : 0.05), 20);
    // Penalty for long duration (too wide = less punchy)
    if (timeDelta > 50) strength -= 10;
    // Bonus for freshness
    if (lastPivotAge < 3) strength += 10;

    strength = Math.max(10, Math.min(strength, 100));

    // Multi-pivot (Triple) check
    let isTriple = false;
    if (triple) {
      if (isRegular) {
        isTriple = isBullish
          ? (recentCloses[prev.p] < recentCloses[triple.p] && indicatorValues[prev.i] > indicatorValues[triple.i])
          : (recentCloses[prev.p] > recentCloses[triple.p] && indicatorValues[prev.i] < indicatorValues[triple.i]);
      } else {
        isTriple = isBullish
          ? (recentCloses[prev.p] > recentCloses[triple.p] && indicatorValues[prev.i] < indicatorValues[triple.i])
          : (recentCloses[prev.p] < recentCloses[triple.p] && indicatorValues[prev.i] > indicatorValues[triple.i]);
      }
    }

    const signalType = isBullish
      ? (isHidden ? SignalType.BULLISH_HIDDEN : SignalType.BULLISH_DIVERGENCE)
      : (isHidden ? SignalType.BEARISH_HIDDEN : SignalType.BEARISH_DIVERGENCE);

    return {
      signalType,
      isHidden,
      strength: Math.round(strength),
      isTriple,
      isStale,
      isTrendAligned,
      description: `${isTriple ? 'Triple ' : ''}${signalType} on ${indicatorType}`
    };
  };

  return findSignals('bullish') || findSignals('bearish');
};
