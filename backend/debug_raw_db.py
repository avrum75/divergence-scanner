from database import SessionLocal
import models
import json

db = SessionLocal()
items = db.query(models.WatchlistItem).all()
print(f"RAW DB COUNT: {len(items)}")
for item in items:
    print(f" - {item.ticker}")
db.close()
