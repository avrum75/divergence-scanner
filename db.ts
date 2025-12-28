import Dexie, { Table } from 'dexie';
import { OhlcvData, Timeframe, Trade } from './types';

export interface BarRecord extends OhlcvData {
    ticker: string;
    timeframe: Timeframe;
}

export interface WatchlistRecord {
    ticker: string;
    addedAt: string;
    marketType: 'STOCKS' | 'CRYPTO'; // Market type for the ticker
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

export interface BacklogRecord {
    ticker: string;
    addedAt: string;
}

export class DivergenceScannerDB extends Dexie {
    bars!: Table<BarRecord, [string, string, string]>;
    trades!: Table<Trade, string>;
    watchlist!: Table<WatchlistRecord, string>;
    syncStatus!: Table<SyncStatus, string>;
    ratings!: Table<TickerRating, string>;
    notes!: Table<TickerNotes, string>;
    backlog!: Table<BacklogRecord, string>;

    constructor() {
        super('DivergenceScannerDB');
        // Version 10: Add backlog table
        this.version(10).stores({
            bars: '[ticker+timeframe+time]',
            trades: 'id, ticker, timestamp',
            watchlist: 'ticker',
            syncStatus: 'id',
            ratings: 'ticker',
            notes: 'ticker',
            backlog: 'ticker'
        });

        // Version 9: Add marketType to watchlist
        this.version(9).stores({
            bars: '[ticker+timeframe+time]',
            trades: 'id, ticker, timestamp',
            watchlist: 'ticker',
            syncStatus: 'id',
            ratings: 'ticker',
            notes: 'ticker'
        }).upgrade(async (tx) => {
            // Migration: Add marketType to existing watchlist records
            const watchlist = tx.table('watchlist');
            await watchlist.toCollection().modify((record: any) => {
                // Default existing records to STOCKS (crypto would have X: prefix)
                if (!record.marketType) {
                    record.marketType = record.ticker.startsWith('X:') ? 'CRYPTO' : 'STOCKS';
                }
            });
        });
    }
}

export const db = new DivergenceScannerDB();
