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

export interface TickerRating {
    ticker: string;
    rating: number; // 1-5 star rating
}

export interface NoteEntry {
    note: string;
    date: string; // ISO timestamp when note was written
}

export interface TickerNotes {
    ticker: string;
    notes: NoteEntry[]; // Array of notes with dates
    updatedAt: string; // Last update timestamp
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
    ratings!: Table<TickerRating, string>;
    notes!: Table<TickerNotes, string>;

    constructor() {
        super('DivergenceScannerDB');
        // Bumped to version 8 to handle notes with dates and history
        this.version(8).stores({
            bars: '[ticker+timeframe+time]',
            trades: 'id, ticker, timestamp',
            watchlist: 'ticker',
            syncStatus: 'id',
            ratings: 'ticker',
            notes: 'ticker'
        });
    }
}

export const db = new DivergenceScannerDB();
