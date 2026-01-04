
#!/bin/bash

# Start the FastAPI backend server

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies if needed
if [ ! -f "venv/.installed" ]; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
    touch venv/.installed
fi

# Check if FMP_API_KEY is set
if [ -z "$FMP_API_KEY" ]; then
    echo "⚠️  Warning: FMP_API_KEY not set. Please export it:"
    echo "   export FMP_API_KEY=your_api_key_here"
    echo ""
    echo "Starting server anyway (will fail on API calls)..."
fi

# Start the server
echo "🚀 Starting FastAPI backend server on http://localhost:8000"
python3.11 main.py


