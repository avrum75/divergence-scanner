import Dexie, { Table } from 'dexie';
import { OhlcvData, Timeframe, Trade } from './types';

export interface BarRecord extends OhlcvData {
    ticker: string;
    timeframe: Timeframe;
}

export interface WatchlistRecord {
    ticker: string;
    addedAt: string;
}

export interface SyncStatus {
    id: string; // "ticker:timeframe"
    lastSync: string; // ISO timestamp
}

export class DivergenceScannerDB extends Dexie {
    bars!: Table<BarRecord, [string, string, string]>;
    trades!: Table<Trade, string>;
    watchlist!: Table<WatchlistRecord, string>;
    syncStatus!: Table<SyncStatus, string>;

    constructor() {
        super('DivergenceScannerDB');
        // Bumped to version 4 to handle sync status
        this.version(4).stores({
            bars: '[ticker+timeframe+time]',
            trades: 'id, ticker, timestamp',
            watchlist: 'ticker',
            syncStatus: 'id'
        });
    }
}

export const db = new DivergenceScannerDB();
