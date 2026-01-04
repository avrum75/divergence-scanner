# Divergence Scanner Backend

FastAPI backend server for fetching fundamental data from Financial Modeling Prep API.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables:
```bash
# Edit backend/.env and add your FMP_API_KEY
# The .env file is already created, just add your key:
# FMP_API_KEY=your_api_key_here
```

The backend will automatically load the API key from the `.env` file.

3. Run the server:
```bash
python main.py
```

Or using uvicorn directly:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server will run on `http://localhost:8000`

## API Endpoints

- `GET /api/fundamentals/{ticker}` - Get company fundamentals for a ticker
- `GET /health` - Health check endpoint

## Example

```bash
curl http://localhost:8000/api/fundamentals/AAPL
```

