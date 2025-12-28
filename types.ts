export interface OhlcvData {
  time: string; // ISO date or timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData extends OhlcvData {
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  ema?: number;
}

export enum Timeframe {
  H1 = '1H',
  H4 = '4H',
  D1 = '1D'
}

export enum SignalType {
  BULLISH_DIVERGENCE = 'Bullish',
  BEARISH_DIVERGENCE = 'Bearish',
  BULLISH_HIDDEN = 'Bullish Hidden',
  BEARISH_HIDDEN = 'Bearish Hidden',
  NONE = 'None'
}

export enum IndicatorType {
  RSI = 'RSI',
  MACD = 'MACD'
}

export interface ConsolidatedAlert {
  ticker: string;
  signals: {
    timeframe: Timeframe;
    signalType: SignalType;
    indicator: IndicatorType;
    description: string;
    isHidden?: boolean;
    strength?: number; // 0-100
    isTriple?: boolean; // Multi-pivot
    isConfirmed?: boolean; // RSI+MACD Convergence
    isStale?: boolean; // More than 10 candles old
    isTrendAligned?: boolean; // Aligned with macro trend
  }[];
  price: number;
  timestamp: string;
}

export interface Alert {
  id: string;
  ticker: string;
  timeframe: Timeframe;
  signalType: SignalType;
  indicator: IndicatorType;
  price: number;
  timestamp: string;
  description: string;
}

export interface Trade {
  id: string;
  ticker: string;
  entryPrice: number;
  amount: number;
  type: 'LONG' | 'SHORT';
  timestamp: string;
  pnlPercent?: number; // Snapshot for simulation
}

export interface TickerSearchResult {
  ticker: string;
  name: string;
  market: string;
  type?: string;
}

export interface TickerData {
  symbol: string;
  data: Record<Timeframe, IndicatorData[]>;
  livePrice?: number;
  syncStatus?: {
    [key in Timeframe]: boolean; // true if current
  };
}