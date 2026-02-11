"""
FastAPI Backend for Divergence Scanner
Handles fundamental data fetching from Yahoo Finance and SQLite database operations
"""

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time
import random
from sqlalchemy.orm import Session
from sqlalchemy import text
import json

# Database imports
import models
from database import engine, get_db

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Divergence Scanner API")

# Startup event to verify database tables
@app.on_event("startup")
async def startup_event():
    """Ensure database tables exist on startup"""
    try:
        models.Base.metadata.create_all(bind=engine)
        print("✅ Database tables verified/created")
    except Exception as e:
        print(f"❌ Error creating database tables: {e}")
        import traceback
        traceback.print_exc()

# CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for running yfinance (which is synchronous)
executor = ThreadPoolExecutor(max_workers=5)

# Rate limiting: track last request time
last_request_time = 0
min_request_interval = 2.0  # Minimum 2 seconds between requests to avoid rate limits

# Cache for fundamentals (24 hours)
fundamentals_cache = {}
financials_cache = {}
CACHE_DURATION = timedelta(hours=24)


# --- Pydantic Models for API ---

class FundamentalsResponse(BaseModel):
    ticker: str
    name: str
    sector: str
    industry: str
    bio: str
    stats: dict


class FinancialStatementsResponse(BaseModel):
    income_statement: str
    balance_sheet: str
    current_price: Optional[float]

# Database DTOs
class BarData(BaseModel):
    ticker: str
    timeframe: str
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float

class WatchlistCreate(BaseModel):
    ticker: str
    market_type: str = "STOCKS"

class WatchlistItem(BaseModel):
    ticker: str
    market_type: str
    added_at: datetime
    
    class Config:
        from_attributes = True

class NoteCreate(BaseModel):
    ticker: str
    content: str
    
class NoteResponse(BaseModel):
    id: int
    ticker: str
    content: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class RatingCreate(BaseModel):
    ticker: str
    rating: int

class RatingResponse(BaseModel):
    ticker: str
    rating: int
    
    class Config:
        from_attributes = True

class TradeCreate(BaseModel):
    id: str
    ticker: str
    entry_price: float
    amount: float
    type: str
    timestamp: str
    pnl_percent: Optional[float] = None

class TradeResponse(TradeCreate):
    class Config:
        from_attributes = True

class SyncStatusUpdate(BaseModel):
    id: str
    last_sync: str


# --- Helper Functions ---

def format_large_number(num: Optional[float]) -> Optional[str]:
    """Format large numbers (e.g., 383000000000 -> '383B')"""
    if num is None:
        return None
    try:
        abs_num = abs(num)
        if abs_num >= 1e12:
            return f"{num / 1e12:.1f}T"
        elif abs_num >= 1e9:
            return f"{num / 1e9:.1f}B"
        elif abs_num >= 1e6:
            return f"{num / 1e6:.1f}M"
        elif abs_num >= 1e3:
            return f"{num / 1e3:.1f}K"
        return f"{num:.2f}"
    except (TypeError, ValueError):
        return None


def truncate_bio(text: Optional[str], max_length: int = 300) -> str:
    """Truncate bio text to max_length characters"""
    if not text:
        return "N/A"
    if len(text) <= max_length:
        return text
    return text[:max_length] + "..."


def fetch_yfinance_data(ticker: str):
    """Synchronous function to fetch data from yfinance with rate limiting"""
    global last_request_time
    
    # Rate limiting: wait if needed
    current_time = time.time()
    time_since_last = current_time - last_request_time
    if time_since_last < min_request_interval:
        sleep_time = min_request_interval - time_since_last + random.uniform(0, 0.2)
        time.sleep(sleep_time)
    last_request_time = time.time()
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            return info
        except Exception as e:
            error_str = str(e)
            # Check if it's a rate limit error
            if "429" in error_str or "Too Many Requests" in error_str:
                if attempt < max_retries - 1:
                    # Exponential backoff: wait longer on each retry (5s, 10s, 20s)
                    wait_time = (5 * (2 ** attempt)) + random.uniform(0, 2)
                    print(f"⚠️ Rate limited for {ticker}, waiting {wait_time:.1f}s before retry {attempt + 1}/{max_retries}")
                    time.sleep(wait_time)
                    continue
                else:
                    raise Exception(f"yfinance rate limit error after {max_retries} attempts: {error_str}")
            else:
                raise Exception(f"yfinance error: {error_str}")
    
    raise Exception(f"yfinance error: Failed after {max_retries} attempts")


def fetch_financial_statements(ticker: str):
    """Synchronous function to fetch financial statements from yfinance with rate limiting"""
    global last_request_time
    
    # Rate limiting: wait if needed
    current_time = time.time()
    time_since_last = current_time - last_request_time
    if time_since_last < min_request_interval:
        sleep_time = min_request_interval - time_since_last + random.uniform(0, 0.2)
        time.sleep(sleep_time)
    last_request_time = time.time()
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            financials = stock.financials  # Income Statement
            balance_sheet = stock.balance_sheet  # Balance Sheet
            
            # Get current price
            current_price = info.get("currentPrice") or info.get("regularMarketPrice") or None
            
            # Format financials as text table
            income_statement_text = format_dataframe_as_table(financials, "Income Statement")
            balance_sheet_text = format_dataframe_as_table(balance_sheet, "Balance Sheet")
            
            return {
                "income_statement": income_statement_text,
                "balance_sheet": balance_sheet_text,
                "current_price": current_price
            }
        except Exception as e:
            error_str = str(e)
            # Check if it's a rate limit error
            if "429" in error_str or "Too Many Requests" in error_str:
                if attempt < max_retries - 1:
                    # Exponential backoff: wait longer on each retry (5s, 10s, 20s)
                    wait_time = (5 * (2 ** attempt)) + random.uniform(0, 2)
                    print(f"⚠️ Rate limited for {ticker}, waiting {wait_time:.1f}s before retry {attempt + 1}/{max_retries}")
                    time.sleep(wait_time)
                    continue
                else:
                    raise Exception(f"yfinance rate limit error after {max_retries} attempts: {error_str}")
            else:
                raise Exception(f"yfinance error: {error_str}")
    
    raise Exception(f"yfinance error: Failed after {max_retries} attempts")


def format_dataframe_as_table(df, title: str) -> str:
    """Format pandas DataFrame as a text table for LLM consumption"""
    try:
        if df is None:
            return f"{title}:\nNo data available.\n"
        
        # Check if it's a pandas DataFrame and if it's empty
        if hasattr(df, 'empty') and df.empty:
            return f"{title}:\nNo data available.\n"
        
        result = f"{title}:\n\n"
        
        # Use to_string() with better formatting for readability
        # Include all rows and columns, format numbers properly
        try:
            df_str = df.to_string(
                max_rows=None,  # Show all rows
                max_cols=None,  # Show all columns
            )
        except:
            # Fallback if to_string() fails
            df_str = str(df)
        
        result += df_str
        result += "\n\n"
        
        # Add helpful context about the data structure
        result += f"Note: Columns represent fiscal years (most recent first, typically leftmost column). "
        result += f"Rows represent financial line items. "
        result += f"Use the most recent column (leftmost) for current year data. "
        result += f"Look for 'Total Revenue' or 'Revenue' row for revenue data, and 'Basic EPS' or 'Diluted EPS' or 'Earnings Per Share' for earnings per share.\n\n"
        
        return result
    except Exception as e:
        return f"{title}:\nError formatting data: {str(e)}\n"


# --- API Endpoints ---

@app.get("/api/fundamentals/{ticker}", response_model=FundamentalsResponse)
async def get_fundamentals(ticker: str):
    """
    Get company fundamentals for a given ticker.
    Uses yfinance (Yahoo Finance) with 24-hour caching.
    """
    # Normalize ticker (remove X: prefix for crypto)
    normalized_ticker = ticker.replace("X:", "").upper()
    
    # Check if it's a crypto ticker
    if ticker.startswith("X:"):
        raise HTTPException(
            status_code=400,
            detail="Fundamental data is not available for crypto assets"
        )
    
    # Check cache
    cache_key = normalized_ticker
    if cache_key in fundamentals_cache:
        cached_data, cached_time = fundamentals_cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            return cached_data
    
    try:
        # Fetch company data from yfinance (run in thread pool since it's synchronous)
        loop = asyncio.get_event_loop()
        info = await loop.run_in_executor(executor, fetch_yfinance_data, normalized_ticker)
        
        # Check if we got valid data
        if not info or len(info) == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No data found for {normalized_ticker}"
            )
        
        # Extract data from yfinance info dictionary
        company_name = info.get("longName") or info.get("shortName") or normalized_ticker
        sector = info.get("sector") or "N/A"
        industry = info.get("industry") or "N/A"
        description = info.get("longBusinessSummary") or info.get("longDescription") or None
        
        # Financial metrics
        pe_ratio = info.get("trailingPE") or info.get("forwardPE") or None
        forward_pe = info.get("forwardPE") or None
        peg_ratio = info.get("pegRatio") or None
        
        # Revenue data
        revenue = info.get("totalRevenue") or info.get("revenue") or None
        revenue_growth = info.get("revenueGrowth")  # Already a percentage
        
        # Debt data
        total_debt = info.get("totalDebt") or info.get("debtToEquity") or None
        debt_to_equity = info.get("debtToEquity") or None
        
        # Extract and format data
        fundamentals = FundamentalsResponse(
            ticker=normalized_ticker,
            name=company_name,
            sector=sector,
            industry=industry,
            bio=truncate_bio(description),
            stats={
                "pe_ratio": pe_ratio,
                "forward_pe": forward_pe,
                "peg_ratio": peg_ratio,
                "revenue": format_large_number(revenue),
                "revenue_growth": revenue_growth * 100 if revenue_growth is not None else None,  # Convert to percentage
                "total_debt": format_large_number(total_debt),
                "debt_to_equity": debt_to_equity,
            }
        )
        
        # Cache the result
        fundamentals_cache[cache_key] = (fundamentals, datetime.now())
        
        return fundamentals
        
    except HTTPException:
        raise
    except Exception as e:
        # Return cached data if available, even if expired
        if cache_key in fundamentals_cache:
            cached_data, _ = fundamentals_cache[cache_key]
            return cached_data
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch fundamentals: {str(e)}"
        )


@app.get("/api/financials/{ticker}", response_model=FinancialStatementsResponse)
async def get_financials(ticker: str):
    """
    Get financial statements (Income Statement and Balance Sheet) for a given ticker.
    Uses yfinance with 24-hour caching.
    """
    # Normalize ticker (remove X: prefix for crypto)
    normalized_ticker = ticker.replace("X:", "").upper()
    
    # Check if it's a crypto ticker
    if ticker.startswith("X:"):
        raise HTTPException(
            status_code=400,
            detail="Financial statements are not available for crypto assets"
        )
    
    # Check cache
    cache_key = f"financials_{normalized_ticker}"
    if cache_key in financials_cache:
        cached_data, cached_time = financials_cache[cache_key]
        if datetime.now() - cached_time < CACHE_DURATION:
            return cached_data
    
    try:
        # Fetch financial statements from yfinance (run in thread pool since it's synchronous)
        loop = asyncio.get_event_loop()
        financial_data = await loop.run_in_executor(executor, fetch_financial_statements, normalized_ticker)
        
        # Create response
        response = FinancialStatementsResponse(
            income_statement=financial_data["income_statement"],
            balance_sheet=financial_data["balance_sheet"],
            current_price=financial_data["current_price"]
        )
        
        # Cache the result
        financials_cache[cache_key] = (response, datetime.now())
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        # Return cached data if available, even if expired
        if cache_key in financials_cache:
            cached_data, _ = financials_cache[cache_key]
            return cached_data
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch financial statements: {str(e)}"
        )

# --- Database Endpoints ---

# Watchlist
# Watchlist
class WatchlistItemResponse(BaseModel):
    ticker: str
    market_type: str
    added_at: datetime
    business_score: Optional[str] = None
    
    class Config:
        from_attributes = True

@app.get("/api/watchlist", response_model=List[WatchlistItemResponse])
def get_watchlist(db: Session = Depends(get_db)):
    try:
        # Fetch watchlist items
        watchlist_items = db.query(models.WatchlistItem).all()
        
        # Fetch analyses for these tickers
        tickers = [item.ticker for item in watchlist_items]
        analyses = []
        if tickers:
            analyses = db.query(models.GoodBusinessAnalysis).filter(models.GoodBusinessAnalysis.ticker.in_(tickers)).all()
        
        # Map analyses by ticker
        analysis_map = {a.ticker: a.analysis for a in analyses}
        
        results = []
        for item in watchlist_items:
            score = None
            if item.ticker in analysis_map:
                try:
                    # Strip markdown code block markers if present
                    analysis_text = analysis_map[item.ticker].strip()
                    if analysis_text.startswith("```json"):
                        analysis_text = analysis_text[7:]
                    if analysis_text.startswith("```"):
                        analysis_text = analysis_text[3:]
                    if analysis_text.endswith("```"):
                        analysis_text = analysis_text[:-3]
                    analysis_text = analysis_text.strip()
                    
                    # Extract JSON from the beginning
                    brace_count = 0
                    json_start = -1
                    json_end = -1
                    for i, char in enumerate(analysis_text):
                        if char == '{':
                            if json_start == -1:
                                json_start = i
                            brace_count += 1
                        elif char == '}':
                            brace_count -= 1
                            if brace_count == 0 and json_start != -1:
                                json_end = i
                                break
                    
                    if json_start != -1 and json_end != -1:
                        json_str = analysis_text[json_start:json_end + 1]
                        analysis_json = json.loads(json_str)
                    else:
                        analysis_json = json.loads(analysis_text)
                    
                    # Try to get score from verdict.score first
                    if "verdict" in analysis_json and "score" in analysis_json["verdict"]:
                        score = analysis_json["verdict"]["score"]
                    # If not available, calculate from metrics
                    elif "metrics" in analysis_json:
                        metrics = analysis_json["metrics"]
                        passed = sum(1 for metric in metrics.values() if isinstance(metric, dict) and metric.get("pass") is True)
                        total = len([m for m in metrics.values() if isinstance(m, dict) and "pass" in m])
                        if total > 0:
                            score = f"{passed}/{total}"
                except Exception as e:
                    print(f"Error parsing analysis for {item.ticker}: {e}")
                    
            results.append(WatchlistItemResponse(
                ticker=item.ticker,
                market_type=item.market_type,
                added_at=item.added_at,
                business_score=score
            ))
            
        return results
    except Exception as e:
        import traceback
        error_detail = f"Error getting watchlist: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/api/watchlist")
def add_watchlist(item: WatchlistCreate, db: Session = Depends(get_db)):
    db_item = models.WatchlistItem(ticker=item.ticker, market_type=item.market_type)
    try:
        merged_item = db.merge(db_item)
        db.commit()
        db.refresh(merged_item)
        return merged_item
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/watchlist/{ticker}")
def delete_watchlist(ticker: str, db: Session = Depends(get_db)):
    db.query(models.WatchlistItem).filter(models.WatchlistItem.ticker == ticker).delete()
    db.commit()
    return {"status": "ok"}

# Notes
@app.get("/api/notes", response_model=List[NoteResponse])
def get_all_notes(db: Session = Depends(get_db)):
    return db.query(models.Note).all()

@app.get("/api/notes/{ticker}", response_model=List[NoteResponse])
def get_notes(ticker: str, db: Session = Depends(get_db)):
    return db.query(models.Note).filter(models.Note.ticker == ticker).order_by(models.Note.created_at.desc()).all()

@app.post("/api/notes")
def add_note(note: NoteCreate, db: Session = Depends(get_db)):
    db_note = models.Note(ticker=note.ticker, content=note.content)
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

# Ratings
@app.get("/api/ratings", response_model=List[RatingResponse])
def get_ratings(db: Session = Depends(get_db)):
    return db.query(models.Rating).all()

@app.post("/api/ratings")
def set_rating(rating: RatingCreate, db: Session = Depends(get_db)):
    try:
        # Validate rating value (should be 1-5 or similar)
        if not isinstance(rating.rating, int) or rating.rating < 0 or rating.rating > 10:
            raise HTTPException(status_code=400, detail=f"Invalid rating value: {rating.rating}. Must be between 0 and 10.")
        
        # Check if rating already exists
        existing = db.query(models.Rating).filter(models.Rating.ticker == rating.ticker).first()
        if existing:
            existing.rating = rating.rating
            db.commit()
            db.refresh(existing)
            return existing
        else:
            db_rating = models.Rating(ticker=rating.ticker, rating=rating.rating)
            db.add(db_rating)
            db.commit()
            db.refresh(db_rating)
            return db_rating
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        error_detail = f"Error setting rating for {rating.ticker}: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

# Trades
@app.get("/api/trades", response_model=List[TradeResponse])
def get_trades(db: Session = Depends(get_db)):
    return db.query(models.Trade).order_by(models.Trade.timestamp.desc()).all()

@app.post("/api/trades")
def add_trade(trade: TradeCreate, db: Session = Depends(get_db)):
    db_trade = models.Trade(
        id=trade.id,
        ticker=trade.ticker,
        entry_price=trade.entry_price,
        amount=trade.amount,
        type=trade.type,
        timestamp=trade.timestamp,
        pnl_percent=trade.pnl_percent
    )
    db.merge(db_trade)
    db.commit()
    return db_trade

# Bars (Market Data)
@app.get("/api/bars/{ticker}/{timeframe}")
def get_bars(ticker: str, timeframe: str, limit: Optional[int] = None, sort: str = "asc", db: Session = Depends(get_db)):
    try:
        query = db.query(models.BarRecord)\
            .filter(models.BarRecord.ticker == ticker, models.BarRecord.timeframe == timeframe)
        
        if sort == "desc":
            query = query.order_by(models.BarRecord.time.desc())
        else:
            query = query.order_by(models.BarRecord.time.asc())
            
        if limit:
            query = query.limit(limit)
            
        return query.all()
    except Exception as e:
        import traceback
        error_detail = f"Error getting bars for {ticker}/{timeframe}: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/api/bars/bulk")
def create_bars(bars: List[BarData], db: Session = Depends(get_db)):
    # Use fast bulk insert
    if not bars:
        return {"count": 0}
    
    # Simple strategy: try to insert ignoring duplicates (or use upsert logic)
    # SQLAlchemy Core is faster for bulk
    
    try:
        # Convert Pydantic models to dicts
        mappings = [bar.dict() for bar in bars]
        
        # We need to handle conflicts. 
        # SQLite: INSERT OR REPLACE or INSERT OR IGNORE
        # SQLAlchemy requires some dialect specific logic for upsert, 
        # but for simplicity we can delete existing in range or just insert ignore.
        
        # Let's use a simpler approach: 
        # Filter existing records to avoid unique constraint errors?
        # Or just use `merge` (slow for bulk)
        
        # Better: ON CONFLICT DO UPDATE (Upsert)
        from sqlalchemy.dialects.sqlite import insert
        
        stmt = insert(models.BarRecord).values(mappings)
        stmt = stmt.on_conflict_do_update(
            index_elements=['ticker', 'timeframe', 'time'],
            set_={
                'open': stmt.excluded.open,
                'high': stmt.excluded.high,
                'low': stmt.excluded.low,
                'close': stmt.excluded.close,
                'volume': stmt.excluded.volume
            }
        )
        
        db.execute(stmt)
        db.commit()
        
        return {"status": "ok", "count": len(bars)}
    except Exception as e:
        db.rollback()
        # Fallback to slower line-by-line if needed or just raise
        print(f"Bulk insert failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Sync Status
@app.get("/api/sync_status/{id}")
def get_sync_status(id: str, db: Session = Depends(get_db)):
    try:
        return db.query(models.SyncStatus).filter(models.SyncStatus.id == id).first()
    except Exception as e:
        import traceback
        error_detail = f"Error getting sync status for {id}: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/api/sync_status")
def update_sync_status(status: SyncStatusUpdate, db: Session = Depends(get_db)):
    db_status = models.SyncStatus(id=status.id, last_sync=status.last_sync)
    db.merge(db_status)
    db.commit()
    return db_status

# Backlog
@app.get("/api/backlog")
def get_backlog(db: Session = Depends(get_db)):
    return db.query(models.BacklogItem).all()

@app.post("/api/backlog")
def add_backlog(ticker: str, db: Session = Depends(get_db)):
    # Simple body handling, FastAPI expects JSON or query param. 
    # Better to use Pydantic model for body.
    # But for quick fix, assume query param or simple body if defined.
    # Let's use Pydantic model for consistency.
    pass 

@app.post("/api/backlog/{ticker}")
def add_to_backlog(ticker: str, db: Session = Depends(get_db)):
    item = models.BacklogItem(ticker=ticker)
    db.merge(item)
    db.commit()
    return {"status": "ok"}

@app.delete("/api/backlog/{ticker}")
def remove_from_backlog(ticker: str, db: Session = Depends(get_db)):
    db.query(models.BacklogItem).filter(models.BacklogItem.ticker == ticker).delete()
    db.commit()
    return {"status": "ok"}


class GoodBusinessCreate(BaseModel):
    ticker: str
    analysis: str
    created_at: str

@app.get("/api/good_business/{ticker}")
def get_good_business_analysis(ticker: str, db: Session = Depends(get_db)):
    analysis = db.query(models.GoodBusinessAnalysis).filter(models.GoodBusinessAnalysis.ticker == ticker.upper()).first()
    return analysis # Returns null (None) if not found, which is valid JSON null

@app.get("/api/good_business/scores")
def get_business_scores(tickers: str = Query(..., description="Comma-separated list of tickers"), db: Session = Depends(get_db)):
    """
    Get business scores for multiple tickers.
    Query param: tickers=comma-separated list (e.g., tickers=AAPL,GOOGL,NVDA)
    Returns: { "AAPL": "6/7", "GOOGL": null, ... }
    """
    try:
        ticker_list = [t.strip().upper() for t in tickers.split(',') if t.strip()]
        if not ticker_list:
            return {}
        
        analyses = db.query(models.GoodBusinessAnalysis).filter(models.GoodBusinessAnalysis.ticker.in_(ticker_list)).all()
        
        result = {}
        for analysis in analyses:
            try:
                # Strip markdown code block markers if present
                analysis_text = analysis.analysis.strip()
                if analysis_text.startswith("```json"):
                    analysis_text = analysis_text[7:]  # Remove ```json
                if analysis_text.startswith("```"):
                    analysis_text = analysis_text[3:]  # Remove ```
                if analysis_text.endswith("```"):
                    analysis_text = analysis_text[:-3]  # Remove trailing ```
                analysis_text = analysis_text.strip()
                
                # Try to extract JSON from the beginning (in case there's markdown after)
                # Find the first { and match until the closing }
                brace_count = 0
                json_start = -1
                json_end = -1
                for i, char in enumerate(analysis_text):
                    if char == '{':
                        if json_start == -1:
                            json_start = i
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0 and json_start != -1:
                            json_end = i
                            break
                
                if json_start != -1 and json_end != -1:
                    json_str = analysis_text[json_start:json_end + 1]
                    analysis_json = json.loads(json_str)
                else:
                    # Fallback: try parsing the whole thing
                    analysis_json = json.loads(analysis_text)
                
                # Try to get score from verdict.score first
                score = None
                if "verdict" in analysis_json and "score" in analysis_json["verdict"]:
                    score = analysis_json["verdict"]["score"]
                # If not available, calculate from metrics
                elif "metrics" in analysis_json:
                    metrics = analysis_json["metrics"]
                    passed = sum(1 for metric in metrics.values() if isinstance(metric, dict) and metric.get("pass") is True)
                    total = len([m for m in metrics.values() if isinstance(m, dict) and "pass" in m])
                    if total > 0:
                        score = f"{passed}/{total}"
                if score:
                    result[analysis.ticker] = score
                else:
                    result[analysis.ticker] = None
            except Exception as e:
                print(f"Error parsing analysis for {analysis.ticker}: {e}")
                import traceback
                traceback.print_exc()
                result[analysis.ticker] = None
        
        # Include all requested tickers (set to null if no analysis found)
        for ticker in ticker_list:
            if ticker not in result:
                result[ticker] = None
        
        # Debug: print result before returning
        print(f"DEBUG: Returning scores for {ticker_list}: {result}")
        
        # Always return a dict, never None
        return result if result else {}
    except Exception as e:
        import traceback
        error_detail = f"Error getting business scores: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/api/good_business")
def save_good_business_analysis(data: GoodBusinessCreate, db: Session = Depends(get_db)):
    # Parse created_at if necessary or keep as string/datetime conversion handled by Pydantic/SQLAlchemy
    # For simplicity, we trust the client or handle parsing if needed. 
    # But for a robust app, we should parse it. The frontend sends ISO string.
    try:
         dt = datetime.fromisoformat(data.created_at.replace('Z', '+00:00'))
    except:
         dt = datetime.utcnow()
         
    db_analysis = models.GoodBusinessAnalysis(
        ticker=data.ticker,
        analysis=data.analysis,
        created_at=dt
    )
    db.merge(db_analysis)
    db.commit()
    return db_analysis




# Scanner Results
@app.get("/api/scanner/results")
def get_scanner_results(db: Session = Depends(get_db)):
    """Get all scanner results"""
    try:
        results = db.query(models.ScannerResult).all()
        scanner_results = []
        for result in results:
            try:
                signals = json.loads(result.signals) if result.signals else []
                scanner_results.append({
                    "ticker": result.ticker,
                    "signals": signals,
                    "price": result.price,
                    "timestamp": result.timestamp,
                    "discoveredAt": result.discovered_at
                })
            except json.JSONDecodeError:
                continue
        return scanner_results
    except Exception as e:
        import traceback
        error_detail = f"Error getting scanner results: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)

@app.post("/api/scanner/results")
def save_scanner_results(alerts: List[dict], db: Session = Depends(get_db)):
    """Save scanner results (replace all existing)"""
    try:
        # Delete all existing results
        db.query(models.ScannerResult).delete()
        
        # Insert new results
        for alert in alerts:
            db_result = models.ScannerResult(
                ticker=alert["ticker"],
                signals=json.dumps(alert.get("signals", [])),
                price=alert.get("price", 0.0),
                timestamp=alert.get("timestamp", ""),
                discovered_at=alert.get("discoveredAt")
            )
            db.add(db_result)
        
        db.commit()
        return {"status": "ok", "count": len(alerts)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# --- Backtesting Endpoints ---

from backtesting.engine import list_strategies, load_strategy, get_pine_script, run_backtest


class BacktestRequest(BaseModel):
    strategy_id: str
    ticker: str
    timeframe: str
    param_overrides: Optional[dict] = None


@app.get("/api/strategies")
def get_strategies():
    """List all available backtesting strategies."""
    return list_strategies()


@app.get("/api/strategies/{strategy_id}")
def get_strategy(strategy_id: str):
    """Get strategy config and Pine Script source."""
    try:
        config = load_strategy(strategy_id)
        pine = get_pine_script(strategy_id)
        return {
            "config": config,
            "pine_script": pine,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")


@app.post("/api/backtest/run")
def run_backtest_endpoint(req: BacktestRequest, db: Session = Depends(get_db)):
    """Run a backtest for a strategy on a specific ticker/timeframe."""
    try:
        config = load_strategy(req.strategy_id)
        config['id'] = req.strategy_id
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Strategy '{req.strategy_id}' not found")

    # Load bars from database
    bars_query = db.query(models.BarRecord)\
        .filter(models.BarRecord.ticker == req.ticker, models.BarRecord.timeframe == req.timeframe)\
        .order_by(models.BarRecord.time.asc())\
        .all()

    if not bars_query or len(bars_query) < 50:
        raise HTTPException(status_code=400, detail=f"Not enough data for {req.ticker}/{req.timeframe}. Need at least 50 bars, got {len(bars_query) if bars_query else 0}.")

    bars = [
        {
            'time': b.time,
            'open': b.open,
            'high': b.high,
            'low': b.low,
            'close': b.close,
            'volume': b.volume,
            'ticker': b.ticker,
            'timeframe': b.timeframe,
        }
        for b in bars_query
    ]

    result = run_backtest(bars, config, req.param_overrides)
    result['ticker'] = req.ticker
    result['timeframe'] = req.timeframe

    # Save result to database
    db_result = models.BacktestResult(
        strategy_id=req.strategy_id,
        strategy_name=config.get('name', ''),
        ticker=req.ticker,
        timeframe=req.timeframe,
        parameters=json.dumps(result.get('parameters', {})),
        metrics=json.dumps(result.get('metrics', {})),
        trades=json.dumps(result.get('trades', [])),
        signals_found=result.get('signals_found', 0),
        bar_count=result.get('bar_count', 0),
        date_range_start=result.get('date_range', {}).get('start', ''),
        date_range_end=result.get('date_range', {}).get('end', ''),
    )
    db.add(db_result)
    db.commit()
    db.refresh(db_result)
    result['id'] = db_result.id

    return result


@app.get("/api/backtest/results")
def get_backtest_results(
    strategy_id: Optional[str] = None,
    ticker: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get saved backtest results, optionally filtered."""
    query = db.query(models.BacktestResult).order_by(models.BacktestResult.created_at.desc())
    if strategy_id:
        query = query.filter(models.BacktestResult.strategy_id == strategy_id)
    if ticker:
        query = query.filter(models.BacktestResult.ticker == ticker)
    results = query.limit(50).all()

    return [
        {
            'id': r.id,
            'strategy_id': r.strategy_id,
            'strategy_name': r.strategy_name,
            'ticker': r.ticker,
            'timeframe': r.timeframe,
            'parameters': json.loads(r.parameters) if r.parameters else {},
            'metrics': json.loads(r.metrics) if r.metrics else {},
            'signals_found': r.signals_found,
            'bar_count': r.bar_count,
            'date_range': {'start': r.date_range_start, 'end': r.date_range_end},
            'created_at': r.created_at.isoformat() if r.created_at else None,
        }
        for r in results
    ]


@app.get("/api/backtest/results/{result_id}")
def get_backtest_result(result_id: int, db: Session = Depends(get_db)):
    """Get a specific backtest result with full trade list."""
    r = db.query(models.BacktestResult).filter(models.BacktestResult.id == result_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Backtest result not found")

    return {
        'id': r.id,
        'strategy_id': r.strategy_id,
        'strategy_name': r.strategy_name,
        'ticker': r.ticker,
        'timeframe': r.timeframe,
        'parameters': json.loads(r.parameters) if r.parameters else {},
        'metrics': json.loads(r.metrics) if r.metrics else {},
        'trades': json.loads(r.trades) if r.trades else [],
        'signals_found': r.signals_found,
        'bar_count': r.bar_count,
        'date_range': {'start': r.date_range_start, 'end': r.date_range_end},
        'created_at': r.created_at.isoformat() if r.created_at else None,
    }


@app.delete("/api/backtest/results/{result_id}")
def delete_backtest_result(result_id: int, db: Session = Depends(get_db)):
    """Delete a specific backtest result."""
    db.query(models.BacktestResult).filter(models.BacktestResult.id == result_id).delete()
    db.commit()
    return {"status": "ok"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "data_source": "yfinance",
        "database": "sqlite",
        "cache_size": len(fundamentals_cache),
        "financials_cache_size": len(financials_cache)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
