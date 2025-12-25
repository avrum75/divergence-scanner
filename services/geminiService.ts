import { GoogleGenAI } from "@google/genai";
import { Alert } from "../types";

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