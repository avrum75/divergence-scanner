"""
Backtesting engine for divergence strategies.
Reads strategy configs, runs against historical bars, produces trade reports.
"""

import json
import math
import os
from datetime import datetime
from typing import List, Dict, Optional, Any

from .indicators import calculate_rsi, calculate_macd, calculate_ema, find_pivots

STRATEGIES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'strategies')


def load_strategy(name: str) -> dict:
    """Load a strategy config JSON by name (without extension)."""
    path = os.path.join(STRATEGIES_DIR, f"{name}.json")
    with open(path, 'r') as f:
        return json.load(f)


def list_strategies() -> List[dict]:
    """List all available strategy configs."""
    strategies = []
    for filename in sorted(os.listdir(STRATEGIES_DIR)):
        if filename.endswith('.json'):
            path = os.path.join(STRATEGIES_DIR, filename)
            with open(path, 'r') as f:
                config = json.load(f)
            config['id'] = filename.replace('.json', '')
            # Read corresponding pine script if exists
            pine_file = config.get('pine_script', '')
            pine_path = os.path.join(STRATEGIES_DIR, pine_file)
            config['has_pine_script'] = os.path.exists(pine_path)
            strategies.append(config)
    return strategies


def get_pine_script(name: str) -> Optional[str]:
    """Read the Pine Script source for a strategy."""
    config = load_strategy(name)
    pine_file = config.get('pine_script', '')
    pine_path = os.path.join(STRATEGIES_DIR, pine_file)
    if os.path.exists(pine_path):
        with open(pine_path, 'r') as f:
            return f.read()
    return None


def _detect_divergences(
    bars: List[dict],
    params: dict,
    direction: str,
) -> List[dict]:
    """
    Detect divergence signals in historical bar data.
    Returns list of signal dicts with bar index and price info.
    """
    closes = [b['close'] for b in bars]
    highs = [b['high'] for b in bars]
    lows = [b['low'] for b in bars]

    rsi_period = params.get('rsi_period', 14)
    pivot_lookback = params.get('pivot_lookback', 3)
    min_rsi_delta = params.get('min_rsi_delta', 3.0)
    min_price_delta_pct = params.get('min_price_delta_pct', 0.1)
    min_pivot_spacing = params.get('min_pivot_spacing', 4)
    max_pivot_age = params.get('max_pivot_age', 10)

    indicator = params.get('indicator', 'RSI')

    # Calculate indicators
    rsi_values = calculate_rsi(closes, rsi_period)

    if indicator == 'RSI':
        ind_values = rsi_values
        ind_tolerance = 0.5
    else:
        macd_data = calculate_macd(closes)
        ind_values = macd_data['histogram']
        ind_tolerance = 0.01

    is_bullish = direction == 'LONG'

    # Price data: lows for bullish, highs for bearish
    price_data = lows if is_bullish else highs
    pivot_type = 'low' if is_bullish else 'high'

    # Find pivots
    price_pivots = find_pivots(price_data, pivot_type, pivot_lookback, 0)
    ind_pivots = find_pivots(ind_values, pivot_type, pivot_lookback, ind_tolerance)

    # RSI zone filter thresholds
    rsi_zone_max = params.get('rsi_zone_max', 100)  # bullish: RSI must be below this
    rsi_zone_min = params.get('rsi_zone_min', 0)    # bearish: RSI must be above this

    signals = []

    # Sliding window: for each pair of consecutive price pivots, check for divergence
    match_window = pivot_lookback + 5

    for pi in range(1, len(price_pivots)):
        prev_pp = price_pivots[pi - 1]
        last_pp = price_pivots[pi]

        # Spacing check
        spacing = abs(last_pp - prev_pp)
        if spacing < min_pivot_spacing:
            continue

        # Match indicator pivots to price pivots
        def find_nearest_ind(bar_idx: int) -> Optional[int]:
            best = None
            best_dist = float('inf')
            for ip in ind_pivots:
                dist = abs(ip - bar_idx)
                if dist <= match_window and dist < best_dist:
                    best_dist = dist
                    best = ip
            return best

        prev_ip = find_nearest_ind(prev_pp)
        last_ip = find_nearest_ind(last_pp)

        if prev_ip is None or last_ip is None:
            continue
        if prev_ip == last_ip:
            continue

        # Check divergence condition
        if is_bullish:
            # Bullish: price lower low + indicator higher low
            price_ll = price_data[last_pp] < price_data[prev_pp]
            ind_hl = ind_values[last_ip] > ind_values[prev_ip]
            divergence = price_ll and ind_hl
        else:
            # Bearish: price higher high + indicator lower high
            price_hh = price_data[last_pp] > price_data[prev_pp]
            ind_lh = ind_values[last_ip] < ind_values[prev_ip]
            divergence = price_hh and ind_lh

        if not divergence:
            continue

        # Magnitude filters
        rsi_delta = abs(ind_values[last_ip] - ind_values[prev_ip])
        if rsi_delta < min_rsi_delta:
            continue

        price_ref = price_data[prev_pp] if price_data[prev_pp] != 0 else 0.0001
        price_delta_pct = abs(price_data[last_pp] - price_data[prev_pp]) / abs(price_ref) * 100
        if price_delta_pct < min_price_delta_pct:
            continue

        # RSI zone filter
        rsi_at_pivot = rsi_values[last_ip] if last_ip < len(rsi_values) and not math.isnan(rsi_values[last_ip]) else 50
        if is_bullish and rsi_at_pivot > rsi_zone_max:
            continue
        if not is_bullish and rsi_at_pivot < rsi_zone_min:
            continue

        # Signal confirmed! The signal bar is `pivot_lookback` bars after the pivot
        # because pivots are confirmed only after lookback bars pass
        signal_bar = last_pp + pivot_lookback
        if signal_bar >= len(bars):
            continue

        signals.append({
            'bar_index': signal_bar,
            'time': bars[signal_bar]['time'],
            'price': closes[signal_bar],
            'pivot_price': price_data[last_pp],
            'prev_pivot_price': price_data[prev_pp],
            'rsi': rsi_at_pivot,
            'rsi_delta': round(rsi_delta, 2),
            'price_delta_pct': round(price_delta_pct, 3),
        })

    return signals


def run_backtest(
    bars: List[dict],
    strategy_config: dict,
    param_overrides: Optional[dict] = None,
) -> dict:
    """
    Run a backtest on historical bar data using a strategy config.

    Args:
        bars: List of OHLCV dicts (sorted ascending by time)
        strategy_config: Strategy config dict (from JSON)
        param_overrides: Optional parameter overrides

    Returns:
        Backtest result dict with metrics and trades
    """
    params = dict(strategy_config.get('parameters', {}))
    if param_overrides:
        params.update(param_overrides)

    direction = strategy_config.get('direction', 'LONG')
    tp_pct = params.get('take_profit_pct', 3.0) / 100.0
    sl_pct = params.get('stop_loss_pct', 2.0) / 100.0

    # Detect all divergence signals
    signals = _detect_divergences(bars, {**params, 'indicator': strategy_config.get('indicator', 'RSI')}, direction)

    # Simulate trades
    trades = []
    position = None  # Current open position

    for signal in signals:
        sig_idx = signal['bar_index']

        # If already in a position, skip this signal
        if position is not None:
            continue

        # Enter on the next bar's open after the signal
        entry_idx = sig_idx + 1
        if entry_idx >= len(bars):
            continue

        entry_price = bars[entry_idx]['open']
        entry_time = bars[entry_idx]['time']

        if direction == 'LONG':
            tp_price = entry_price * (1 + tp_pct)
            sl_price = entry_price * (1 - sl_pct)
        else:
            tp_price = entry_price * (1 - tp_pct)
            sl_price = entry_price * (1 + sl_pct)

        position = {
            'entry_idx': entry_idx,
            'entry_price': entry_price,
            'entry_time': entry_time,
            'tp_price': tp_price,
            'sl_price': sl_price,
            'signal': signal,
        }

        # Walk forward bar by bar to check exit conditions
        for i in range(entry_idx + 1, len(bars)):
            bar = bars[i]

            if direction == 'LONG':
                # Check stop loss first (worst case)
                if bar['low'] <= sl_price:
                    pnl_pct = -sl_pct * 100
                    trades.append(_make_trade(position, i, sl_price, bar['time'], pnl_pct, 'STOP_LOSS'))
                    position = None
                    break
                # Check take profit
                if bar['high'] >= tp_price:
                    pnl_pct = tp_pct * 100
                    trades.append(_make_trade(position, i, tp_price, bar['time'], pnl_pct, 'TAKE_PROFIT'))
                    position = None
                    break
            else:  # SHORT
                # Check stop loss first
                if bar['high'] >= sl_price:
                    pnl_pct = -sl_pct * 100
                    trades.append(_make_trade(position, i, sl_price, bar['time'], pnl_pct, 'STOP_LOSS'))
                    position = None
                    break
                # Check take profit
                if bar['low'] <= tp_price:
                    pnl_pct = tp_pct * 100
                    trades.append(_make_trade(position, i, tp_price, bar['time'], pnl_pct, 'TAKE_PROFIT'))
                    position = None
                    break

    # Close any remaining open position at last bar's close
    if position is not None:
        last_bar = bars[-1]
        if direction == 'LONG':
            pnl_pct = (last_bar['close'] - position['entry_price']) / position['entry_price'] * 100
        else:
            pnl_pct = (position['entry_price'] - last_bar['close']) / position['entry_price'] * 100
        trades.append(_make_trade(position, len(bars) - 1, last_bar['close'], last_bar['time'], pnl_pct, 'OPEN'))
        position = None

    # Calculate metrics
    metrics = _calculate_metrics(trades, bars)

    return {
        'strategy': strategy_config.get('name', 'Unknown'),
        'strategy_id': strategy_config.get('id', ''),
        'direction': direction,
        'parameters': params,
        'ticker': bars[0].get('ticker', '') if bars else '',
        'timeframe': bars[0].get('timeframe', '') if bars else '',
        'bar_count': len(bars),
        'date_range': {
            'start': bars[0]['time'] if bars else '',
            'end': bars[-1]['time'] if bars else '',
        },
        'metrics': metrics,
        'trades': trades,
        'signals_found': len(signals),
    }


def _make_trade(position: dict, exit_idx: int, exit_price: float, exit_time: str, pnl_pct: float, exit_reason: str) -> dict:
    return {
        'entry_time': position['entry_time'],
        'entry_price': round(position['entry_price'], 6),
        'exit_time': exit_time,
        'exit_price': round(exit_price, 6),
        'pnl_pct': round(pnl_pct, 3),
        'exit_reason': exit_reason,
        'bars_held': exit_idx - position['entry_idx'],
        'signal': {
            'rsi': position['signal'].get('rsi'),
            'rsi_delta': position['signal'].get('rsi_delta'),
            'price_delta_pct': position['signal'].get('price_delta_pct'),
        },
    }


def _calculate_metrics(trades: List[dict], bars: List[dict]) -> dict:
    """Calculate performance metrics from a list of trades."""
    if not trades:
        return {
            'total_trades': 0,
            'wins': 0,
            'losses': 0,
            'win_rate': 0.0,
            'avg_pnl_pct': 0.0,
            'avg_win_pct': 0.0,
            'avg_loss_pct': 0.0,
            'max_win_pct': 0.0,
            'max_loss_pct': 0.0,
            'total_pnl_pct': 0.0,
            'profit_factor': 0.0,
            'avg_bars_held': 0,
            'max_drawdown_pct': 0.0,
            'expectancy': 0.0,
            'take_profit_exits': 0,
            'stop_loss_exits': 0,
            'open_exits': 0,
        }

    # Closed trades only (exclude still-open positions for metrics)
    closed = [t for t in trades if t['exit_reason'] != 'OPEN']
    all_for_metrics = closed if closed else trades

    wins = [t for t in all_for_metrics if t['pnl_pct'] > 0]
    losses = [t for t in all_for_metrics if t['pnl_pct'] <= 0]

    total_win = sum(t['pnl_pct'] for t in wins) if wins else 0
    total_loss = abs(sum(t['pnl_pct'] for t in losses)) if losses else 0

    win_rate = len(wins) / len(all_for_metrics) * 100 if all_for_metrics else 0
    avg_pnl = sum(t['pnl_pct'] for t in all_for_metrics) / len(all_for_metrics) if all_for_metrics else 0
    avg_win = total_win / len(wins) if wins else 0
    avg_loss = -total_loss / len(losses) if losses else 0

    # Profit factor
    profit_factor = total_win / total_loss if total_loss > 0 else float('inf') if total_win > 0 else 0

    # Max drawdown (simulated equity curve starting at 100)
    equity = 100.0
    peak = 100.0
    max_dd = 0.0
    for t in trades:
        equity *= (1 + t['pnl_pct'] / 100)
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Expectancy = (win_rate * avg_win) + ((1 - win_rate) * avg_loss)
    wr = len(wins) / len(all_for_metrics) if all_for_metrics else 0
    expectancy = (wr * avg_win) + ((1 - wr) * avg_loss)

    return {
        'total_trades': len(all_for_metrics),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(win_rate, 1),
        'avg_pnl_pct': round(avg_pnl, 3),
        'avg_win_pct': round(avg_win, 3),
        'avg_loss_pct': round(avg_loss, 3),
        'max_win_pct': round(max(t['pnl_pct'] for t in all_for_metrics), 3) if all_for_metrics else 0,
        'max_loss_pct': round(min(t['pnl_pct'] for t in all_for_metrics), 3) if all_for_metrics else 0,
        'total_pnl_pct': round(sum(t['pnl_pct'] for t in all_for_metrics), 3),
        'profit_factor': round(profit_factor, 2) if profit_factor != float('inf') else 999.0,
        'avg_bars_held': round(sum(t['bars_held'] for t in all_for_metrics) / len(all_for_metrics)) if all_for_metrics else 0,
        'max_drawdown_pct': round(max_dd, 2),
        'expectancy': round(expectancy, 3),
        'take_profit_exits': sum(1 for t in trades if t['exit_reason'] == 'TAKE_PROFIT'),
        'stop_loss_exits': sum(1 for t in trades if t['exit_reason'] == 'STOP_LOSS'),
        'open_exits': sum(1 for t in trades if t['exit_reason'] == 'OPEN'),
    }
