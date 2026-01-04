from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Text,
    Boolean,
    UniqueConstraint,
)
from datetime import datetime
from database import Base


class BarRecord(Base):
    __tablename__ = "bars"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    timeframe = Column(String, index=True)
    time = Column(String, index=True)  # ISO Date string
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)

    # Composite unique constraint to prevent duplicate bars
    __table_args__ = (
        UniqueConstraint("ticker", "timeframe", "time", name="uix_ticker_tf_time"),
    )


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    ticker = Column(String, primary_key=True, index=True)
    market_type = Column(String, default="STOCKS")
    added_at = Column(DateTime, default=datetime.utcnow)


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String, index=True)
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Rating(Base):
    __tablename__ = "ratings"

    ticker = Column(String, primary_key=True, index=True)
    rating = Column(Integer)


class Trade(Base):
    __tablename__ = "trades"

    id = Column(String, primary_key=True)
    ticker = Column(String, index=True)
    entry_price = Column(Float)
    amount = Column(Float)
    type = Column(String)  # LONG or SHORT
    timestamp = Column(String)  # ISO string or timestamp
    pnl_percent = Column(Float, nullable=True)


class SyncStatus(Base):
    __tablename__ = "sync_status"

    id = Column(String, primary_key=True)  # "ticker:timeframe"
    last_sync = Column(String)  # ISO timestamp


class BacklogItem(Base):
    __tablename__ = "backlog"
    
    ticker = Column(String, primary_key=True, index=True)
    added_at = Column(DateTime, default=datetime.utcnow)


class GoodBusinessAnalysis(Base):
    __tablename__ = "good_business_analyses"
    
    ticker = Column(String, primary_key=True, index=True)
    analysis = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScannerResult(Base):
    __tablename__ = "scanner_results"
    
    ticker = Column(String, primary_key=True, index=True)
    signals = Column(Text)  # JSON string of signals array
    price = Column(Float)
    timestamp = Column(String)  # ISO timestamp string
    discovered_at = Column(String, nullable=True)  # ISO timestamp string
    last_updated = Column(DateTime, default=datetime.utcnow)
