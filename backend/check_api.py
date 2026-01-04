import urllib.request
import json

url = "http://localhost:8000/api/watchlist"
try:
    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        print(f"API returned {len(data)} items")
        print(f"Sample: {data[:1]}")
except Exception as e:
    print(f"API Error: {e}")
