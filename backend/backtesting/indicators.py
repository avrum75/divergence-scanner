"""
Technical indicator calculations for backtesting.
Mirrors the TypeScript implementations in utils/technicalAnalysis.ts
"""

import math
from typing import List, Optional


def calculate_ema(data: List[float], window: int) -> List[float]:
    """Exponential Moving Average"""
    if not data:
        return []
    k = 2.0 / (window + 1)
    ema = [data[0]]
    for i in range(1, len(data)):
        val = data[i] * k + ema[i - 1] * (1 - k)
        ema.append(val)
    return ema


def calculate_rsi(close_prices: List[float], period: int = 14) -> List[float]:
    """RSI (Relative Strength Index) - Wilder's smoothing method"""
    rsi: List[float] = []
    gains: List[float] = []
    losses: List[float] = []

    for i in range(1, len(close_prices)):
        change = close_prices[i] - close_prices[i - 1]
        gains.append(change if change > 0 else 0.0)
        losses.append(abs(change) if change < 0 else 0.0)

    # Pad for index 0
    rsi.append(float('nan'))
    # Pad for initial period
    for _ in range(1, period):
        rsi.append(float('nan'))

    if len(gains) < period:
        return rsi

    # Initial averages
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # First RSI value
    if avg_loss == 0:
        rsi.append(100.0)
    else:
        rs = avg_gain / avg_loss
        rsi.append(100.0 - (100.0 / (1.0 + rs)))

    # Smoothed calculation
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            rsi.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsi.append(100.0 - (100.0 / (1.0 + rs)))

    return rsi


def calculate_macd(
    close_prices: List[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9
) -> dict:
    """MACD with signal line and histogram"""
    ema_fast = calculate_ema(close_prices, fast)
    ema_slow = calculate_ema(close_prices, slow)

    macd_line = [f - s for f, s in zip(ema_fast, ema_slow)]
    signal_line = calculate_ema(macd_line, signal)
    histogram = [m - s for m, s in zip(macd_line, signal_line)]

    return {
        "macd_line": macd_line,
        "signal_line": signal_line,
        "histogram": histogram,
    }


def find_pivots(
    values: List[float],
    pivot_type: str,
    lookback: int = 5,
    tolerance: float = 0.0
) -> List[int]:
    """
    Find local peaks ('high') or valleys ('low').
    Returns list of indices.
    Mirrors the TS findPivots function.
    """
    pivots: List[int] = []

    for i in range(lookback, len(values) - lookback):
        val = values[i]
        if math.isnan(val):
            continue

        is_pivot = True
        for j in range(1, lookback + 1):
            left_val = values[i - j]
            right_val = values[i + j]
            if math.isnan(left_val) or math.isnan(right_val):
                is_pivot = False
                break

            if pivot_type == 'high':
                if left_val > val + tolerance or right_val > val + tolerance:
                    is_pivot = False
                    break
            else:  # low
                if left_val < val - tolerance or right_val < val - tolerance:
                    is_pivot = False
                    break

        if is_pivot:
            pivots.append(i)

    # De-duplicate nearby pivots (same cluster)
    deduped: List[int] = []
    for idx in pivots:
        if not deduped:
            deduped.append(idx)
            continue
        last_idx = deduped[-1]
        if idx - last_idx <= lookback:
            # Keep the more extreme one
            if pivot_type == 'high':
                if values[idx] > values[last_idx]:
                    deduped[-1] = idx
            else:
                if values[idx] < values[last_idx]:
                    deduped[-1] = idx
        else:
            deduped.append(idx)

    return deduped
