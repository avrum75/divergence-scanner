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
 * Uses strict comparison for price data, but tolerant comparison for indicators
 * (RSI/MACD often have flat zones where adjacent values are nearly equal)
 */
const findPivots = (values: number[], type: 'high' | 'low', range: number = 5, tolerance: number = 0, earlyDetection: boolean = false): number[] => {
  const pivots: number[] = [];
  // For early detection: allow scanning into the tail region with reduced right-side confirmation.
  // Full `range` bars required on the left, but only `minRight` bars needed on the right
  // for bars near the end of the data. This lets us detect pivots sooner.
  const minRight = earlyDetection ? Math.min(2, range) : range;

  for (let i = range; i < values.length - minRight; i++) {
    const val = values[i];
    if (isNaN(val)) continue;

    let isPivot = true;
    // How many right-side bars are available (may be less than `range` near the tail)
    const rightLimit = earlyDetection ? Math.min(range, values.length - 1 - i) : range;

    for (let j = 1; j <= range; j++) {
      // Left side: always check full range
      const leftVal = values[i - j];
      if (isNaN(leftVal)) { isPivot = false; break; }

      if (j <= rightLimit) {
        // Right side: check up to available bars
        const rightVal = values[i + j];
        if (isNaN(rightVal)) { isPivot = false; break; }

        if (type === 'high') {
          if (leftVal > val + tolerance || rightVal > val + tolerance) {
            isPivot = false;
            break;
          }
        } else {
          if (leftVal < val - tolerance || rightVal < val - tolerance) {
            isPivot = false;
            break;
          }
        }
      } else {
        // Beyond available right bars: only check left side
        if (type === 'high') {
          if (leftVal > val + tolerance) { isPivot = false; break; }
        } else {
          if (leftVal < val - tolerance) { isPivot = false; break; }
        }
      }
    }
    if (isPivot) pivots.push(i);
  }

  // Phase 2: De-duplicate pivots that are part of the same flat region:
  // If two pivots are within `range` bars of each other, keep only the most extreme one
  const deduped: number[] = [];
  for (let k = 0; k < pivots.length; k++) {
    if (deduped.length === 0) {
      deduped.push(pivots[k]);
      continue;
    }
    const lastIdx = deduped[deduped.length - 1];
    if (pivots[k] - lastIdx <= range) {
      // Same cluster — keep the more extreme pivot
      if (type === 'high') {
        if (values[pivots[k]] > values[lastIdx]) {
          deduped[deduped.length - 1] = pivots[k];
        }
      } else {
        if (values[pivots[k]] < values[lastIdx]) {
          deduped[deduped.length - 1] = pivots[k];
        }
      }
    } else {
      deduped.push(pivots[k]);
    }
  }

  // Phase 3: Swing significance validation
  // Merge pivots that are sub-peaks/sub-valleys of the same larger formation.
  // Two consecutive pivots of the same type (both highs or both lows) are only
  // considered separate formations if there's meaningful counter-movement between them.
  // E.g., if RSI makes two peaks at 65 and 68 but only dips to 63 between them,
  // that's ONE formation (peak=68), not two separate peaks.
  if (deduped.length < 2) return deduped;

  // Compute minimum swing depth as 10% of the data's range
  let dataMin = Infinity, dataMax = -Infinity;
  for (let m = 0; m < values.length; m++) {
    if (!isNaN(values[m])) {
      if (values[m] < dataMin) dataMin = values[m];
      if (values[m] > dataMax) dataMax = values[m];
    }
  }
  const dataRange = dataMax - dataMin;
  const minSwingDepth = dataRange * 0.10; // 10% of full range

  const validated: number[] = [];
  for (let k = 0; k < deduped.length; k++) {
    if (validated.length === 0) {
      validated.push(deduped[k]);
      continue;
    }

    const prevIdx = validated[validated.length - 1];
    const currIdx = deduped[k];
    const prevVal = values[prevIdx];
    const currVal = values[currIdx];

    // Find the extreme counter-movement between the two pivots
    if (type === 'high') {
      // For two high pivots: find the lowest point between them
      let minBetween = Infinity;
      for (let m = prevIdx + 1; m < currIdx; m++) {
        if (!isNaN(values[m]) && values[m] < minBetween) minBetween = values[m];
      }
      // Swing depth = how far it dropped from the LOWER of the two peaks
      const lowerPeak = Math.min(prevVal, currVal);
      const swingDepth = lowerPeak - minBetween;

      if (swingDepth < minSwingDepth) {
        // Sub-peaks of the same formation — keep only the higher one
        if (currVal > prevVal) {
          validated[validated.length - 1] = currIdx;
        }
      } else {
        validated.push(currIdx);
      }
    } else {
      // For two low pivots: find the highest point between them
      let maxBetween = -Infinity;
      for (let m = prevIdx + 1; m < currIdx; m++) {
        if (!isNaN(values[m]) && values[m] > maxBetween) maxBetween = values[m];
      }
      // Swing depth = how far it rose from the HIGHER of the two valleys
      const higherValley = Math.max(prevVal, currVal);
      const swingDepth = maxBetween - higherValley;

      if (swingDepth < minSwingDepth) {
        // Sub-valleys of the same formation — keep only the lower one
        if (currVal < prevVal) {
          validated[validated.length - 1] = currIdx;
        }
      } else {
        validated.push(currIdx);
      }
    }
  }
  return validated;
};

/**
 * SCANS for Divergences (Regular and Hidden)
 *
 * Regular Divergence (Reversal signals):
 *   Bullish: Price makes Lower Low  + Indicator makes Higher Low
 *   Bearish: Price makes Higher High + Indicator makes Lower High
 *
 * Hidden Divergence (Continuation signals):
 *   Bullish Hidden: Price makes Higher Low  + Indicator makes Lower Low  (uptrend continues)
 *   Bearish Hidden: Price makes Lower High  + Indicator makes Higher High (downtrend continues)
 *
 * Returns ALL valid signals found (not just one), so the caller can see
 * both bullish and bearish signals on the same timeframe.
 */
export const scanForDivergences = (
  candles: IndicatorData[],
  indicatorType: IndicatorType,
  sensitivity: number = 3, // 3 = FAST, 5 = SLOW
  earlyDetection: boolean = false // Detect maturing pivots with fewer right-side bars
): any[] => {

  if (candles.length < 50) return [];

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);
  const lookback = 120;

  // Use actual highs/lows for price pivots (not closes)
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const recentCloses = closes.slice(-lookback);
  const recentVolumes = volumes.slice(-lookback);

  // RSI values for zone awareness (always needed regardless of indicatorType)
  const rsiValues = candles.map(c => c.rsi || 0).slice(-lookback);

  let indicatorValues: number[] = [];
  if (indicatorType === IndicatorType.RSI) {
    indicatorValues = rsiValues;
  } else {
    indicatorValues = candles.map(c => c.macdHist || 0).slice(-lookback);
  }

  // Pre-compute macro trend (shared across bullish/bearish)
  const macroTrendWindow = 50;
  const macroTrendEma = calculateEMA(closes, macroTrendWindow);
  const currentPrice = closes[closes.length - 1];
  const currentEma = macroTrendEma[macroTrendEma.length - 1];
  const isUpTrend = currentPrice > currentEma;

  // Minimum pivot spacing: pivots closer than this are likely the same swing.
  // Reference charts show good divergences have 15-25 bar spacing.
  // 1H(s=5)→12, 4H(s=4)→10, D1(s=3)→8 bars minimum between pivots.
  const MIN_PIVOT_SPACING = Math.max(sensitivity * 2 + 2, 8);

  const findSignals = (type: 'bullish' | 'bearish'): any | null => {
    const isBullish = type === 'bullish';

    // Use lows for bullish pivots, highs for bearish pivots
    const priceData = isBullish ? recentLows : recentHighs;
    // Price pivots: strict (tolerance=0) — price must be a clear local extreme
    const pricePivots = findPivots(priceData, isBullish ? 'low' : 'high', sensitivity, 0, earlyDetection);
    // Indicator pivots: tolerant — RSI/MACD often have flat zones
    // RSI tolerance ~0.5 points, MACD histogram tolerance ~0.01
    const indTolerance = indicatorType === IndicatorType.RSI ? 0.5 : 0.01;
    const indPivots = findPivots(indicatorValues, isBullish ? 'low' : 'high', sensitivity, indTolerance, earlyDetection);

    if (pricePivots.length < 2 || indPivots.length < 2) return null;

    // Always compare the last 2 consecutive price peaks — never skip a peak.
    // Then find an indicator pivot near each. No match → no divergence.
    const matchWindow = sensitivity + 5;

    const lastP = pricePivots[pricePivots.length - 1];
    const prevP = pricePivots[pricePivots.length - 2];
    const tripleP = pricePivots.length >= 3 ? pricePivots[pricePivots.length - 3] : null;

    // Find nearest indicator pivot within the match window
    const findNearestInd = (pIdx: number): number | null => {
      let best: number | null = null;
      let bestDist = Infinity;
      for (const idx of indPivots) {
        const dist = Math.abs(idx - pIdx);
        if (dist <= matchWindow && dist < bestDist) {
          bestDist = dist;
          best = idx;
        }
      }
      return best;
    };

    const lastI = findNearestInd(lastP);
    const prevI = findNearestInd(prevP);

    if (lastI === null || prevI === null) return null;

    const last = { p: lastP, i: lastI };
    const prev = { p: prevP, i: prevI };
    const triple = tripleP !== null ? (() => {
      const ti = findNearestInd(tripleP);
      return ti !== null ? { p: tripleP, i: ti } : null;
    })() : null;

    // --- Early Detection: determine if last pivot is maturing ---
    const dataLength = priceData.length;
    const lastPivotDistFromEnd = (dataLength - 1) - last.p;
    const isInEarlyZone = earlyDetection && lastPivotDistFromEnd < sensitivity;
    let isMaturing = false;

    if (isInEarlyZone) {
      // Bounce validation: confirm price has moved meaningfully away from the pivot.
      // Without this, a flat tail or continued decline could trigger false early pivots.
      const currentClose = recentCloses[recentCloses.length - 1];
      const pivotPrice = priceData[last.p];

      if (isBullish) {
        // For bullish (low pivot): close must be at least 0.3% above the pivot low
        const bouncePercent = (currentClose - pivotPrice) / pivotPrice;
        if (bouncePercent < 0.003) return null;
      } else {
        // For bearish (high pivot): close must be at least 0.3% below the pivot high
        const bouncePercent = (pivotPrice - currentClose) / pivotPrice;
        if (bouncePercent < 0.003) return null;
      }

      isMaturing = true;
    }

    // --- IMPROVEMENT 5: Minimum pivot spacing ---
    // Pivots too close together are noise, not real swings
    const pivotSpacing = Math.abs(last.p - prev.p);
    if (pivotSpacing < MIN_PIVOT_SPACING) return null;

    // --- IMPROVEMENT 8: Price structure validation ---
    // Between the two pivots, price should move in the expected direction
    // (i.e., there should be a visible swing between the two pivot points).
    // Only reject truly flat/noisy structures with wide spacing.
    if (pivotSpacing > 15) {
      const sliceBetween = recentCloses.slice(
        Math.min(prev.p, last.p),
        Math.max(prev.p, last.p) + 1
      );
      if (sliceBetween.length > 4) {
        // Check if there's any meaningful price movement between pivots
        // by looking at the range vs the average price
        const maxP = Math.max(...sliceBetween);
        const minP = Math.min(...sliceBetween);
        const avgP = (maxP + minP) / 2;
        const rangeRatio = avgP > 0 ? (maxP - minP) / avgP : 0;
        // Reject if price barely moves (< 0.2% range) over a wide span
        if (rangeRatio < 0.002) return null;
      }
    }

    // REGULAR DIVERGENCE (Reversal)
    const isRegular = isBullish
      ? (priceData[last.p] < priceData[prev.p] && indicatorValues[last.i] > indicatorValues[prev.i])
      : (priceData[last.p] > priceData[prev.p] && indicatorValues[last.i] < indicatorValues[prev.i]);

    // HIDDEN DIVERGENCE (Trend Continuation)
    const isHidden = isBullish
      ? (priceData[last.p] > priceData[prev.p] && indicatorValues[last.i] < indicatorValues[prev.i])
      : (priceData[last.p] < priceData[prev.p] && indicatorValues[last.i] > indicatorValues[prev.i]);

    if (!isRegular && !isHidden) return null;

    // FRESHNESS CHECK
    const lastPivotAge = (priceData.length - 1) - last.p;
    const isStale = lastPivotAge > 10;

    // TREND ALIGNMENT
    const isTrendAligned = isHidden
      ? (isBullish ? isUpTrend : !isUpTrend)
      : true;

    // Reject hidden divergences against the macro trend
    if (isHidden && !isTrendAligned) return null;

    // Minimum divergence magnitude filter
    // Both price and indicator must show at least a minimal difference
    const priceDelta = Math.abs(priceData[last.p] - priceData[prev.p]) / Math.max(priceData[prev.p], 0.0001);
    const indDelta = Math.abs(indicatorValues[last.i] - indicatorValues[prev.i]);
    const minPriceDelta = 0.001; // 0.1% (reduced from 0.3% — too aggressive for range-bound stocks)
    const minIndDelta = indicatorType === IndicatorType.RSI ? 1.5 : 0.005;
    if (priceDelta < minPriceDelta && indDelta < minIndDelta) return null; // Use AND: reject only if BOTH are tiny

    // --- IMPROVEMENT 7: Revamped strength formula (0-100) ---
    //
    // Design goal: A "textbook" divergence (clear price delta, clear indicator delta,
    // good spacing, fresh, in an extreme RSI zone) should score ~65-75 on its own.
    // Confluence/confirmed bonuses in scanMarket can then push it to 80-100.
    //
    // Components (total possible = 100):
    //   Price magnitude:    0-20
    //   Indicator magnitude: 0-20
    //   Pivot spacing:      5-15
    //   Freshness:          0-15
    //   RSI zone:           0-15
    //   Volume:             0-10
    //   Trend alignment:    0-5
    //
    let strength = 0;

    // Component 1: Price divergence magnitude (0-20)
    // Use log scale: 1% → ~10, 3% → ~15, 10% → ~20
    const priceScore = Math.min(Math.log10(1 + priceDelta * 100) * 12, 20);
    strength += priceScore;

    // Component 2: Indicator divergence magnitude (0-20)
    let indScore = 0;
    if (indicatorType === IndicatorType.RSI) {
      // RSI: 3 points = 6, 5 pts = 10, 10 pts = 20
      indScore = Math.min(indDelta * 2, 20);
    } else {
      // MACD histogram: scale relative to recent range
      const absHist = indicatorValues.filter(v => !isNaN(v)).map(Math.abs);
      const histRange = Math.max(...absHist) - Math.min(...absHist);
      indScore = histRange > 0 ? Math.min((indDelta / histRange) * 40, 20) : 10;
    }
    strength += indScore;

    // Component 3: Pivot spacing quality (5-15)
    // Everything gets at least 5. Sweet spot 12-50 bars gets full 15.
    const timeDelta = pivotSpacing;
    if (timeDelta >= 12 && timeDelta <= 50) {
      strength += 15; // Ideal spacing
    } else if (timeDelta >= 8 && timeDelta <= 60) {
      strength += 10; // Acceptable
    } else {
      strength += 5;  // Marginal
    }

    // Component 4: Freshness bonus (0-15)
    // More generous — most valid divergences are relatively recent
    if (lastPivotAge <= 3) strength += 15;
    else if (lastPivotAge <= 6) strength += 10;
    else if (lastPivotAge <= 10) strength += 5;
    // Stale signals get 0 freshness bonus

    // --- IMPROVEMENT 6: RSI zone awareness (0-15) ---
    const lastRsi = rsiValues[last.p];
    if (indicatorType === IndicatorType.RSI) {
      if (isBullish && lastRsi < 30) strength += 15;       // Classic oversold bullish
      else if (isBullish && lastRsi < 40) strength += 10;  // Near oversold
      else if (isBullish && lastRsi < 50) strength += 3;   // Moderate
      else if (!isBullish && lastRsi > 70) strength += 15;  // Classic overbought bearish
      else if (!isBullish && lastRsi > 60) strength += 10;  // Near overbought
      else if (!isBullish && lastRsi > 50) strength += 3;   // Moderate
    } else {
      // For MACD, give RSI zone bonus if RSI data is available and extreme
      if (isBullish && lastRsi < 35) strength += 12;
      else if (isBullish && lastRsi < 45) strength += 5;
      else if (!isBullish && lastRsi > 65) strength += 12;
      else if (!isBullish && lastRsi > 55) strength += 5;
    }

    // --- IMPROVEMENT 2: Volume confirmation (0-10) ---
    // Check if volume is declining on the second push (confirming exhaustion)
    const prevPivotIdx = prev.p;
    const lastPivotIdx = last.p;
    const volWindowSize = Math.min(3, Math.floor(pivotSpacing / 3));
    if (volWindowSize > 0) {
      const getAvgVolume = (idx: number) => {
        const start = Math.max(0, idx - volWindowSize);
        const end = Math.min(recentVolumes.length - 1, idx + volWindowSize);
        const slice = recentVolumes.slice(start, end + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      };

      const prevVol = getAvgVolume(prevPivotIdx);
      const lastVol = getAvgVolume(lastPivotIdx);

      if (prevVol > 0 && lastVol > 0) {
        const volRatio = lastVol / prevVol;
        if (isBullish && isRegular) {
          if (volRatio < 0.7) strength += 10;
          else if (volRatio < 0.9) strength += 5;
        } else if (!isBullish && isRegular) {
          if (volRatio < 0.7) strength += 10;
          else if (volRatio < 0.9) strength += 5;
        } else if (isHidden) {
          if (volRatio > 1.2) strength += 8;
          else if (volRatio > 1.0) strength += 3;
        }
      }
    }

    // Trend alignment bonus for regular divergences (0-5)
    if (isRegular) {
      const isCounterTrend = isBullish ? !isUpTrend : isUpTrend;
      if (isCounterTrend) strength += 5;
    }

    strength = Math.max(10, Math.min(strength, 100));

    // Multi-pivot (Triple) check
    let isTriple = false;
    if (triple) {
      // Also check spacing for triple
      const tripleSpacing = Math.abs(prev.p - triple.p);
      if (tripleSpacing >= MIN_PIVOT_SPACING) {
        if (isRegular) {
          isTriple = isBullish
            ? (priceData[prev.p] < priceData[triple.p] && indicatorValues[prev.i] > indicatorValues[triple.i])
            : (priceData[prev.p] > priceData[triple.p] && indicatorValues[prev.i] < indicatorValues[triple.i]);
        } else {
          isTriple = isBullish
            ? (priceData[prev.p] > priceData[triple.p] && indicatorValues[prev.i] < indicatorValues[triple.i])
            : (priceData[prev.p] < priceData[triple.p] && indicatorValues[prev.i] > indicatorValues[triple.i]);
        }
      }
    }
    if (isTriple) strength = Math.min(strength + 10, 100); // Triple bonus

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
      isMaturing,
      description: `${isTriple ? 'Triple ' : ''}${isMaturing ? '(Maturing) ' : ''}${signalType} on ${indicatorType}`
    };
  };

  // --- IMPROVEMENT 3: Return ALL valid signals ---
  const signals: any[] = [];
  const bullish = findSignals('bullish');
  const bearish = findSignals('bearish');
  if (bullish) signals.push(bullish);
  if (bearish) signals.push(bearish);
  return signals;
};
