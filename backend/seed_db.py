from database import SessionLocal, engine
import models
from datetime import datetime

# Bind engine
models.Base.metadata.create_all(bind=engine)

db = SessionLocal()

# Add dummy items
items = [
    models.WatchlistItem(ticker="AAPL", market_type="STOCKS", added_at=datetime.utcnow()),
    models.WatchlistItem(ticker="GOOGL", market_type="STOCKS", added_at=datetime.utcnow()),
    models.WatchlistItem(ticker="NVDA", market_type="STOCKS", added_at=datetime.utcnow()),
    models.WatchlistItem(ticker="TSLA", market_type="STOCKS", added_at=datetime.utcnow()),
    models.WatchlistItem(ticker="BTC-USD", market_type="CRYPTO", added_at=datetime.utcnow()),
]

print("Adding items...")
for item in items:
    try:
        db.merge(item)
    except Exception as e:
        print(f"Error adding {item.ticker}: {e}")

db.commit()
print("Committed.")

# Verify
count = db.query(models.WatchlistItem).count()
print(f"Watchlist count: {count}")
db.close()
