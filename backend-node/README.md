# Node.js Backend - Yahoo Finance Scraper

This backend uses Puppeteer to scrape company fundamentals from Yahoo Finance, bypassing CORS and API limitations.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will run on `http://localhost:8000` by default.

## API Endpoints

### GET `/api/fundamentals/:ticker`

Fetches company fundamentals for a given ticker symbol.

**Example:**
```bash
curl http://localhost:8000/api/fundamentals/AAPL
```

**Response:**
```json
{
  "ticker": "AAPL",
  "name": "Apple Inc.",
  "sector": "Technology",
  "industry": "Consumer Electronics",
  "bio": "Apple Inc. designs, manufactures, and markets...",
  "stats": {
    "pe_ratio": 30.5,
    "forward_pe": 28.1,
    "peg_ratio": 1.2,
    "revenue": "383.0B",
    "revenue_growth": null,
    "total_debt": "50.0B",
    "debt_to_equity": 1.45
  }
}
```

### GET `/health`

Health check endpoint.

## Notes

- The browser instance is reused for performance
- Scraping may take 5-10 seconds per request
- Yahoo Finance page structure may change, requiring selector updates
- Crypto tickers are not supported (returns 400 error)

