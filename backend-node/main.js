/**
 * Node.js Backend for Divergence Scanner
 * Uses Puppeteer to scrape Yahoo Finance for company fundamentals
 */

import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8000;

// CORS middleware
app.use(cors({
  origin: ['http://localhost:5001', 'http://127.0.0.1:5001'],
  credentials: true
}));

app.use(express.json());

// Reuse browser instance for performance
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    console.log('🌐 Browser instance created');
  }
  return browser;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
    console.log('🌐 Browser instance closed');
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
    console.log('🌐 Browser instance closed');
  }
  process.exit(0);
});

/**
 * Format large numbers (e.g., 383000000000 -> '383B')
 */
function formatLargeNumber(num) {
  if (num === null || num === undefined || isNaN(num)) {
    return null;
  }
  const absNum = Math.abs(num);
  if (absNum >= 1e12) {
    return `${(num / 1e12).toFixed(1)}T`;
  } else if (absNum >= 1e9) {
    return `${(num / 1e9).toFixed(1)}B`;
  } else if (absNum >= 1e6) {
    return `${(num / 1e6).toFixed(1)}M`;
  } else if (absNum >= 1e3) {
    return `${(num / 1e3).toFixed(1)}K`;
  }
  return num.toFixed(2);
}

/**
 * Truncate bio text to max_length characters
 */
function truncateBio(text, maxLength = 300) {
  if (!text) {
    return 'N/A';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Parse a number from a string, handling various formats
 */
function parseNumber(str) {
  if (!str) return null;
  // Remove commas, spaces, and currency symbols
  const cleaned = str.replace(/[,\s$%]/g, '');
  // Handle negative numbers in parentheses (accounting format)
  const isNegative = cleaned.includes('(') && cleaned.includes(')');
  const numStr = cleaned.replace(/[()]/g, '');
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

/**
 * Scrape Yahoo Finance profile page
 */
async function scrapeProfile(page, ticker) {
  // Try summary page first for company name, then profile for description
  const summaryUrl = `https://finance.yahoo.com/quote/${ticker}?p=${ticker}`;
  console.log(`📄 Navigating to summary: ${summaryUrl}`);
  
  await page.goto(summaryUrl, { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });
  
  // Get company name from summary page
  let companyName = null;
  try {
    await page.waitForSelector('h1', { timeout: 5000 });
    companyName = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1?.textContent?.trim() || null;
    });
  } catch (e) {
    console.warn('Could not get company name from summary');
  }
  
  // Now go to profile page
  const profileUrl = `https://finance.yahoo.com/quote/${ticker}/profile/`;
  console.log(`📄 Navigating to profile: ${profileUrl}`);
  
  await page.goto(profileUrl, { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });

  // Handle cookie consent if present - try multiple selectors
  try {
    const consentSelectors = [
      'button[data-testid="consent-accept"]',
      'button:has-text("Accept all")',
      'button:has-text("Accept")',
      'button:has-text("I agree")',
      'button:has-text("Aceptar")',
      '[data-testid="consent-accept"]'
    ];
    
    for (const selector of consentSelectors) {
      try {
        const button = await page.waitForSelector(selector, { timeout: 2000 });
        if (button) {
          await button.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    // No cookie banner found, continue
  }

  // Wait for the main content to load - try multiple selectors
  try {
    await Promise.race([
      page.waitForSelector('#Col1-0-Profile-Proxy', { timeout: 10000 }),
      page.waitForSelector('section[data-test="qsp-profile"]', { timeout: 10000 }),
      page.waitForSelector('[data-module="Profile"]', { timeout: 10000 }),
      page.waitForSelector('h1', { timeout: 10000 })
    ]);
  } catch (e) {
    console.warn('⚠️ Profile page structure may have changed');
  }

  // Wait a bit for dynamic content to fully load
  await new Promise(resolve => setTimeout(resolve, 3000));

  const profileData = await page.evaluate((nameFromSummary) => {
    // Try multiple selectors for description
    let description = null;
    const descriptionSelectors = [
      '#Col1-0-Profile-Proxy p',
      'section[data-test="qsp-profile"] p',
      '[data-module="Profile"] p',
      '.quote-sub-section p',
      'p[data-test="asset-profile"]',
      'p'
    ];
    
    // Find the longest paragraph (likely the description)
    // But exclude cookie/privacy text
    let longestP = null;
    let maxLength = 0;
    const excludeKeywords = ['cookie', 'privacy', 'consent', 'privacidad', 'consentimiento', 'configuración'];
    
    descriptionSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.textContent?.trim() || '';
        const lowerText = text.toLowerCase();
        // Skip if it contains cookie/privacy keywords
        if (excludeKeywords.some(keyword => lowerText.includes(keyword))) {
          return;
        }
        if (text.length > maxLength && text.length > 50) {
          maxLength = text.length;
          longestP = text;
        }
      });
    });
    
    description = longestP;

    // Extract company name - try multiple selectors (if not already got from summary)
    let extractedName = null;
    const nameSelectors = [
      'h1',
      '[data-test="qsp-profile"] h1',
      'h2',
      '[data-symbol]',
      '.D\\(ib\\) h1'
    ];
    
    for (const selector of nameSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        extractedName = el.textContent.trim();
        break;
      }
    }

    // Extract sector and industry
    let sector = 'N/A';
    let industry = 'N/A';
    
    // Look for sector/industry in various formats
    const allLinks = Array.from(document.querySelectorAll('a'));
    allLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent.trim();
      if (href.includes('/sector/') && text) {
        sector = text;
      } else if (href.includes('/industry/') && text) {
        industry = text;
      }
    });

    // Alternative: look for text patterns in the page
    const pageText = document.body.textContent || '';
    const sectorMatch = pageText.match(/Sector[:\s]+([^\n\r]+)/i);
    const industryMatch = pageText.match(/Industry[:\s]+([^\n\r]+)/i);
    
    if (sectorMatch && sector === 'N/A') {
      sector = sectorMatch[1].trim().split(/\s+/)[0]; // Take first word
    }
    if (industryMatch && industry === 'N/A') {
      industry = industryMatch[1].trim().split(/\s+/)[0];
    }

    return {
      description,
      companyName: nameFromSummary || extractedName,
      sector,
      industry
    };
  }, companyName);

  return profileData;
}

/**
 * Scrape Yahoo Finance financials page
 */
async function scrapeFinancials(page, ticker) {
  const financialsUrl = `https://finance.yahoo.com/quote/${ticker}/financials/`;
  console.log(`📊 Navigating to financials: ${financialsUrl}`);
  
  await page.goto(financialsUrl, { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });

  // Handle cookie consent if present
  try {
    await page.waitForSelector('button:has-text("Accept"), button:has-text("I agree"), [data-testid="consent-accept"]', { timeout: 3000 });
    await page.click('button:has-text("Accept"), button:has-text("I agree"), [data-testid="consent-accept"]');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    // No cookie banner, continue
  }

  // Wait for financials table to load
  try {
    await Promise.race([
      page.waitForSelector('#Col1-0-Financials-Proxy', { timeout: 5000 }),
      page.waitForSelector('section[data-test="qsp-financial"]', { timeout: 5000 }),
      page.waitForSelector('table', { timeout: 5000 }),
      page.waitForSelector('div[data-test="fin-row"]', { timeout: 5000 })
    ]);
  } catch (e) {
    console.warn('⚠️ Financials page structure may have changed');
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  const financialData = await page.evaluate(() => {
    const data = {
      pe_ratio: null,
      forward_pe: null,
      peg_ratio: null,
      revenue: null,
      revenue_growth: null,
      total_debt: null,
      debt_to_equity: null
    };

    // Extract from financials table - look for "Total Revenue" row
    const allRows = Array.from(document.querySelectorAll('div[data-test="fin-row"], tr, div[class*="row"]'));
    allRows.forEach(row => {
      const text = row.textContent || '';
      
      // Look for Total Revenue
      if ((text.includes('Total Revenue') || text.includes('Revenue')) && !data.revenue) {
        const cells = Array.from(row.querySelectorAll('span, td, div'));
        // Usually the second cell contains the value
        for (let i = 1; i < Math.min(cells.length, 5); i++) {
          const cellText = cells[i]?.textContent?.trim();
          if (cellText && cellText.match(/[\d.,]+[BMKT]?/)) {
            data.revenue = cellText;
            break;
          }
        }
      }

      // Look for Total Debt
      if ((text.includes('Total Debt') || text.includes('Total Liabilities')) && !data.total_debt) {
        const cells = Array.from(row.querySelectorAll('span, td, div'));
        for (let i = 1; i < Math.min(cells.length, 5); i++) {
          const cellText = cells[i]?.textContent?.trim();
          if (cellText && cellText.match(/[\d.,]+[BMKT]?/)) {
            data.total_debt = cellText;
            break;
          }
        }
      }
    });

    return data;
  });

  // Also try the key statistics page for P/E and other ratios
  try {
    const keyStatsUrl = `https://finance.yahoo.com/quote/${ticker}/key-statistics/`;
    console.log(`📈 Navigating to key statistics: ${keyStatsUrl}`);
    
    await page.goto(keyStatsUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Handle cookie consent
    try {
      await page.waitForSelector('button:has-text("Accept"), button:has-text("I agree"), [data-testid="consent-accept"]', { timeout: 3000 });
      await page.click('button:has-text("Accept"), button:has-text("I agree"), [data-testid="consent-accept"]');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      // No cookie banner
    }

    await Promise.race([
      page.waitForSelector('#Col1-0-KeyStatistics-Proxy', { timeout: 5000 }),
      page.waitForSelector('section[data-test="qsp-statistics"]', { timeout: 5000 }),
      page.waitForSelector('table', { timeout: 5000 })
    ]);

    await new Promise(resolve => setTimeout(resolve, 2000));

    const keyStats = await page.evaluate(() => {
      const stats = {
        pe_ratio: null,
        forward_pe: null,
        peg_ratio: null,
        debt_to_equity: null
      };

      // Look for P/E ratio and other metrics in tables
      // Yahoo Finance uses tables with labels and values
      const allRows = Array.from(document.querySelectorAll('tr, div[class*="row"]'));
      
      allRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, span, div'));
        if (cells.length >= 2) {
          const label = cells[0]?.textContent?.trim() || '';
          const value = cells[1]?.textContent?.trim() || '';
          
          if (label.includes('Trailing P/E') || label.includes('P/E Ratio (TTM)')) {
            stats.pe_ratio = value;
          }
          if (label.includes('Forward P/E') || label.includes('Forward P/E (1y)')) {
            stats.forward_pe = value;
          }
          if (label.includes('PEG Ratio') || label.includes('PEG Ratio (5 yr expected)')) {
            stats.peg_ratio = value;
          }
          if (label.includes('Total Debt/Equity') || label.includes('Total Debt/Equity (mrq)')) {
            stats.debt_to_equity = value;
          }
        }
      });

      return stats;
    });

    // Merge key stats into financial data
    Object.assign(financialData, keyStats);
  } catch (e) {
    console.warn('⚠️ Could not fetch key statistics:', e.message);
  }

  return financialData;
}

/**
 * Calculate revenue growth from financials
 */
function calculateRevenueGrowth(financialData) {
  // This would require fetching multiple years of data
  // For now, we'll return null and can enhance later
  return null;
}

/**
 * Main endpoint to get company fundamentals
 */
app.get('/api/fundamentals/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
  
  // Check if it's a crypto ticker
  if (ticker.startsWith('X:')) {
    return res.status(400).json({
      error: 'Fundamental data is not available for crypto assets'
    });
  }

  console.log(`🔍 Fetching fundamentals for ${normalizedTicker}`);

  let page = null;
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    
    // Set a reasonable timeout
    page.setDefaultNavigationTimeout(30000);
    
    // Set user agent and language headers to avoid bot detection and get English content
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Scrape profile page
    const profileData = await scrapeProfile(page, normalizedTicker);
    
    // Scrape financials page
    const financialData = await scrapeFinancials(page, normalizedTicker);

    // Parse and format the data
    const fundamentals = {
      ticker: normalizedTicker,
      name: profileData.companyName || normalizedTicker,
      sector: profileData.sector || 'N/A',
      industry: profileData.industry || 'N/A',
      bio: truncateBio(profileData.description),
      stats: {
        pe_ratio: parseNumber(financialData.pe_ratio),
        forward_pe: parseNumber(financialData.forward_pe),
        peg_ratio: parseNumber(financialData.peg_ratio),
        revenue: financialData.revenue ? formatLargeNumber(parseNumber(financialData.revenue)) : null,
        revenue_growth: calculateRevenueGrowth(financialData),
        total_debt: financialData.total_debt ? formatLargeNumber(parseNumber(financialData.total_debt)) : null,
        debt_to_equity: parseNumber(financialData.debt_to_equity)
      }
    };

    console.log(`✅ Successfully fetched fundamentals for ${normalizedTicker}`);
    res.json(fundamentals);

  } catch (error) {
    console.error(`❌ Error fetching fundamentals for ${normalizedTicker}:`, error.message);
    
    // Return a more helpful error message
    if (error.message.includes('net::ERR_NAME_NOT_RESOLVED') || error.message.includes('Navigation timeout')) {
      res.status(500).json({
        error: 'Failed to connect to Yahoo Finance. Please check your internet connection.'
      });
    } else if (error.message.includes('Target closed')) {
      res.status(500).json({
        error: 'Browser connection lost. Please try again.'
      });
    } else {
      res.status(500).json({
        error: `Failed to fetch fundamentals: ${error.message}`
      });
    }
  } finally {
    if (page) {
      await page.close();
    }
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    data_source: 'yahoo-finance-scraper',
    browser_connected: browser !== null
  });
});

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log(`🚀 Yahoo Finance scraper backend running on http://localhost:${PORT}`);
  console.log(`📊 Endpoint: http://localhost:${PORT}/api/fundamentals/:ticker`);
});

