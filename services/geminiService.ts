import { GoogleGenAI } from "@google/genai";
import { Alert } from "../types";
import { FinancialStatements } from "./fundamentalService";

// Note: In a real app, strict error handling for missing keys is needed.
// Here we assume process.env.API_KEY is available or handle gracefully.

export const analyzeAlertWithAI = async (alert: Alert): Promise<string> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return "API Key not found. Please configure your environment to use AI analysis.";
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
      You are an expert financial analyst. 
      Analyze the following trading signal:
      Ticker: ${alert.ticker}
      Timeframe: ${alert.timeframe}
      Signal: ${alert.signalType} on ${alert.indicator} indicator.
      Price: $${alert.price.toFixed(2)}
      Context: ${alert.description}

      Provide a concise 3-sentence breakdown:
      1. What this pattern technically indicates (reversal/continuation).
      2. The psychological implication for traders.
      3. A suggested risk management tip (e.g., where to place stops).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Could not generate analysis.";
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return "AI service is currently unavailable. Please check your API key.";
  }
};

/**
 * Analyze a stock using the "Good Business" criteria
 * Uses the exact prompt provided by the user
 */
export const analyzeGoodBusiness = async (ticker: string, financialData: FinancialStatements): Promise<string> => {
  try {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return "API Key not found. Please configure your environment to use AI analysis.";
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Use the exact prompt provided by the user
    const priceText = financialData.current_price 
      ? `$${financialData.current_price.toFixed(2)}`
      : "Not available - please request from user";
    
    const prompt = `The "Good Business" Analyzer Prompt
Role: You are an Expert Fundamental Analyst who follows a specific "Quality Growth" investment strategy.

Objective:
Your goal is to analyze financial data tables (provided as images or text) to determine if a stock qualifies as a "Good Business" based on strict growth and valuation criteria.

Input Data:
The user will upload an image of a financial statement (Income Statement / Balance Sheet).
Crucial: If the image does not contain the Current Share Price, you must ask the user for it, or perform the analysis using only the growth metrics and mark the Valuation section as "Pending Price."

Step 1: Data Extraction
Extract the following values from the provided table. The financial statements show annual fiscal year data, not TTM. Use the most recent fiscal year (typically the leftmost column) as the current year.

Revenue: Most recent fiscal year vs. 4 years ago (to calculate 5-year growth) and most recent vs. 1 year ago.
EPS (Basic or Diluted): Most recent fiscal year vs. 4 years ago and most recent vs. 1 year ago.
Total Debt: Most recent available.
Stockholders' Equity: Most recent available.
Net Income: Most recent fiscal year.

Important: The columns represent fiscal years with the most recent year typically in the leftmost column. Look for rows labeled "Total Revenue", "Revenue", "Basic EPS", "Diluted EPS", "Earnings Per Share", "Total Debt", "Stockholders Equity", "Net Income", etc.

Step 2: The "Good Business" Criteria
Evaluate the extracted data against these rules:

Sales Growth (5-Year): Must be > 50% total growth (approx 8-10% CAGR).
Sales Growth (1-Year): Must be > 5%.
EPS Growth (5-Year): Must be > 10% total.
EPS Growth (1-Year): Must be > 5%.
Debt-to-Equity: Must be < 0.50 (Strict) or < 0.70 (Acceptable Risk).
Return on Equity (ROE): Must be > 15%. (Formula: Net Income / Equity).
Valuation (PEG): Must be < 2.0. (Formula: (Price / EPS) / Growth Rate). Use the 5-year sales growth rate (annualized) or a conservative 15-20% if not specified.

Step 3: Output Format
You must output the result in TWO parts:

PART 1: JSON Scorecard (MUST be valid JSON, placed at the very top)
You must return the result using this exact schema:

{
  "ticker": "String (e.g. UBER)",
  "current_price": Number,
  "verdict": {
    "is_good_business": Boolean,
    "score": "String (e.g. 6/7)",
    "summary": "String (Brief 1-sentence analysis of why it passed/failed)"
  },
  "metrics": {
    "sales_growth_5y": {
      "value": "String (e.g. +184%)",
      "raw_data": "String (e.g. $17.4B -> $49.6B)",
      "target": "> 50%",
      "pass": Boolean
    },
    "sales_growth_1y": {
      "value": "String",
      "target": "> 5%",
      "pass": Boolean
    },
    "eps_growth_5y": {
      "value": "String",
      "raw_data": "String (e.g. -$0.26 -> $7.96)",
      "target": "> 10%",
      "pass": Boolean
    },
    "eps_growth_1y": {
      "value": "String",
      "target": "> 5%",
      "pass": Boolean
    },
    "debt_to_equity": {
      "value": Number,
      "target": "< 0.50",
      "pass": Boolean
    },
    "roe": {
      "value": "String",
      "target": "> 15%",
      "pass": Boolean
    },
    "peg_ratio": {
      "value": Number,
      "target": "< 2.0",
      "pass": Boolean,
      "note": "String (Optional note about calculation method)"
    }
  }
}

PART 2: Detailed Markdown Analysis (after the JSON)
After the JSON scorecard, provide a detailed markdown analysis including:

The "Good Business" Scorecard: [Ticker/Company Name]

Criterion|Target|[Ticker] Result|Verdict

Detailed Analysis: Briefly explain why it passed or failed specific sections (e.g., "Revenue is great, but Debt is worrying").

Instructions for Missing Data:
If the table is missing previous years' data (e.g., no 2021 column), state "Insufficient Data" for that specific row but calculate the rest.

CRITICAL: The JSON must be valid and parseable. Place it at the very beginning of your response, followed by a clear separator (e.g., "---" or "## Detailed Analysis"), then the markdown analysis.

Financial Data:
Income Statement:
${financialData.income_statement}

Balance Sheet:
${financialData.balance_sheet}

Current Share Price: ${priceText}

Ticker: ${ticker}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Could not generate analysis.";
  } catch (error) {
    console.error("Good Business Analysis failed:", error);
    return "AI service is currently unavailable. Please check your API key.";
  }
};