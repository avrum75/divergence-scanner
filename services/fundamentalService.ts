/**
 * Fundamental Data Service
 * Fetches company fundamentals from Node.js backend (which scrapes Yahoo Finance using Puppeteer)
 * Implements 24-hour caching to minimize scraping requests
 */

export interface CompanyFundamentals {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  bio: string; // Limited to 300 chars + "..."
  stats: {
    pe_ratio: number | null;
    forward_pe: number | null;
    peg_ratio: number | null;
    revenue: string | null; // Formatted as "383B"
    revenue_growth: number | null; // YOY percentage
    total_debt: string | null; // Formatted as "50B"
    debt_to_equity: number | null;
  };
}

export interface FinancialStatements {
  income_statement: string;  // Formatted text table
  balance_sheet: string;     // Formatted text table
  current_price: number | null;
}

interface CachedFinancialStatements {
  data: FinancialStatements;
  timestamp: number;
}

interface CachedFundamentals {
  data: CompanyFundamentals;
  timestamp: number;
}

// In-memory cache with 24-hour expiration
const fundamentalsCache = new Map<string, CachedFundamentals>();
const financialsCache = new Map<string, CachedFinancialStatements>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Backend API URL (Node.js Puppeteer server)
const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:5001';

/**
 * Get company fundamentals from Node.js backend (Yahoo Finance scraper)
 */
export const getCompanyFundamentals = async (ticker: string): Promise<CompanyFundamentals | null> => {
  // Normalize ticker (remove X: prefix for crypto)
  const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
  
  // Check if it's a crypto ticker
  const isCrypto = ticker.startsWith('X:');
  if (isCrypto) {
    console.log(`ℹ️  Fundamental data not available for crypto ticker: ${ticker}`);
    return null;
  }

  // Check cache first
  const cached = fundamentalsCache.get(normalizedTicker);
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    console.log(`📦 Using cached fundamentals for ${normalizedTicker}`);
    return cached.data;
  }

  try {
    console.log(`📊 Fetching fundamentals for ${normalizedTicker} from backend...`);
    
    const url = `${BACKEND_URL}/api/fundamentals/${normalizedTicker}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`⚠️  No data found for ${normalizedTicker}`);
        return null;
      }
      if (response.status === 400) {
        // Crypto ticker or invalid request
        const errorData = await response.json().catch(() => ({ detail: 'Invalid request' }));
        console.warn(`⚠️  ${errorData.detail || 'Invalid request'}`);
        return null;
      }
      throw new Error(`Backend API error: ${response.status}`);
    }

    const data: CompanyFundamentals = await response.json();
    
    // Cache the result
    fundamentalsCache.set(normalizedTicker, {
      data,
      timestamp: Date.now()
    });

    console.log(`✅ Loaded fundamentals for ${normalizedTicker}`);
    return data;

  } catch (error: any) {
    console.error(`❌ Failed to fetch fundamentals for ${normalizedTicker}:`, error.message || error);
    
    // Return cached data even if expired, as fallback
    if (cached) {
      console.log(`📦 Using expired cache as fallback for ${normalizedTicker}`);
      return cached.data;
    }
    
    return null;
  }
};

/**
 * Clear cache for a specific ticker (useful for manual refresh)
 */
export const clearFundamentalsCache = (ticker: string): void => {
  const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
  fundamentalsCache.delete(normalizedTicker);
};

/**
 * Clear all cached fundamentals
 */
export const clearAllFundamentalsCache = (): void => {
  fundamentalsCache.clear();
};

/**
 * Get financial statements (Income Statement and Balance Sheet) for a ticker
 */
export const getFinancialStatements = async (ticker: string): Promise<FinancialStatements | null> => {
  // Normalize ticker (remove X: prefix for crypto)
  const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
  
  // Check if it's a crypto ticker
  const isCrypto = ticker.startsWith('X:');
  if (isCrypto) {
    console.log(`ℹ️  Financial statements not available for crypto ticker: ${ticker}`);
    return null;
  }

  // Check cache first
  const cached = financialsCache.get(normalizedTicker);
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    console.log(`📦 Using cached financial statements for ${normalizedTicker}`);
    return cached.data;
  }

  try {
    console.log(`📊 Fetching financial statements for ${normalizedTicker} from backend...`);
    
    const url = `${BACKEND_URL}/api/financials/${normalizedTicker}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`⚠️  No financial data found for ${normalizedTicker}`);
        return null;
      }
      if (response.status === 400) {
        // Crypto ticker or invalid request
        const errorData = await response.json().catch(() => ({ detail: 'Invalid request' }));
        console.warn(`⚠️  ${errorData.detail || 'Invalid request'}`);
        return null;
      }
      throw new Error(`Backend API error: ${response.status}`);
    }

    const data: FinancialStatements = await response.json();
    
    // Cache the result
    financialsCache.set(normalizedTicker, {
      data,
      timestamp: Date.now()
    });

    console.log(`✅ Loaded financial statements for ${normalizedTicker}`);
    return data;

  } catch (error: any) {
    console.error(`❌ Failed to fetch financial statements for ${normalizedTicker}:`, error.message || error);
    
    // Return cached data even if expired, as fallback
    if (cached) {
      console.log(`📦 Using expired cache as fallback for ${normalizedTicker}`);
      return cached.data;
    }
    
    return null;
  }
};
