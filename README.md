<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1raMOZtC4UDAvIeKpjtBpbTLgHctT6XZL

## Run Locally

**Prerequisites:**  Node.js


1. Install frontend dependencies:
   `npm install`

2. Set up the backend:
   ```bash
   cd backend
   pip install -r requirements.txt
   export FMP_API_KEY=your_api_key_here  # Get free key at https://financialmodelingprep.com/
   python main.py
   ```
   The backend will run on `http://localhost:8000`

3. Set the API keys in `.env.local` (frontend):
   - `GEMINI_API_KEY` - Your Gemini API key (for AI analysis)
   - `POLYGON_API_KEY` - Your Polygon.io API key (for market data)

4. Run the frontend app:
   `npm run dev`
