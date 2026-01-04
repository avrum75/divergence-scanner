import React, { useState, useEffect } from 'react';
import { getCompanyFundamentals, CompanyFundamentals, getFinancialStatements } from '../services/fundamentalService';
import { analyzeGoodBusiness } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
// import { db } from '../db'; // REMOVED

interface CompanyProfileProps {
  ticker: string | null;
}

const CompanyProfile: React.FC<CompanyProfileProps> = ({ ticker }) => {
  const [fundamentals, setFundamentals] = useState<CompanyFundamentals | null>(null);
  const [loading, setLoading] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false); // Panel collapsed by default
  const [goodBusinessAnalysis, setGoodBusinessAnalysis] = useState<string | null>(null);
  const [analyzingGoodBusiness, setAnalyzingGoodBusiness] = useState(false);
  const [goodBusinessError, setGoodBusinessError] = useState<string | null>(null);
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);
  const [scorecardData, setScorecardData] = useState<any>(null);
  const [markdownAnalysis, setMarkdownAnalysis] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) {
      setFundamentals(null);
      setIsExpanded(false); // Reset to collapsed when ticker changes
      setGoodBusinessAnalysis(null);
      setGoodBusinessError(null);
      setAnalysisDate(null);
      setScorecardData(null);
      setMarkdownAnalysis(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Load existing Good Business analysis from backend
    const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();

    // Use fetch directly for now until we add it to api.ts
    const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
    fetch(`${API_URL}/api/good_business/${normalizedTicker}`)
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(savedAnalysis => {
        if (savedAnalysis) {
          setGoodBusinessAnalysis(savedAnalysis.analysis);
          setAnalysisDate(savedAnalysis.created_at); // Note: backend uses created_at
          parseAnalysisResponse(savedAnalysis.analysis);
        }
      })
      .catch(err => {
        console.error('Error loading saved analysis:', err);
      });

    getCompanyFundamentals(ticker)
      .then(data => {
        setFundamentals(data);
        if (!data) {
          setError('Fundamental data not available for this ticker');
        }
      })
      .catch(err => {
        console.error('Error loading fundamentals:', err);
        setError('Failed to load fundamental data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [ticker]);

  const parseAnalysisResponse = (analysis: string) => {
    try {
      // Try to extract JSON from the beginning of the response
      // Look for JSON object - find the first { and match until the closing }
      // Handle nested objects by counting braces
      let braceCount = 0;
      let jsonStart = -1;
      let jsonEnd = -1;

      for (let i = 0; i < analysis.length; i++) {
        if (analysis[i] === '{') {
          if (jsonStart === -1) {
            jsonStart = i;
          }
          braceCount++;
        } else if (analysis[i] === '}') {
          braceCount--;
          if (braceCount === 0 && jsonStart !== -1) {
            jsonEnd = i;
            break;
          }
        }
      }

      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = analysis.substring(jsonStart, jsonEnd + 1);
        const jsonData = JSON.parse(jsonStr);
        setScorecardData(jsonData);

        // Extract markdown part (everything after the JSON)
        let markdownPart = analysis.substring(jsonEnd + 1).trim();
        // Remove separator lines like "---" or "## Detailed Analysis" or empty lines
        markdownPart = markdownPart
          .replace(/^[-]{3,}\s*\n?/m, '')
          .replace(/^##\s*Detailed\s*Analysis\s*\n?/im, '')
          .replace(/^\s*\n\s*\n/gm, '\n') // Remove multiple empty lines
          .trim();

        // Remove any JSON-like content that might have slipped through (code blocks with JSON)
        markdownPart = markdownPart.replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '');
        markdownPart = markdownPart.replace(/```\s*\{[\s\S]*?\}\s*```/gi, '');

        setMarkdownAnalysis(markdownPart || null);
      } else {
        // No JSON found, treat entire response as markdown
        console.warn('No JSON found in analysis response');
        setScorecardData(null);
        setMarkdownAnalysis(analysis);
      }
    } catch (err) {
      console.error('Error parsing analysis JSON:', err);
      // If JSON parsing fails, treat entire response as markdown
      setScorecardData(null);
      setMarkdownAnalysis(analysis);
    }
  };

  const handleGoodBusinessAnalysis = async () => {
    if (!ticker) return;

    setAnalyzingGoodBusiness(true);
    setGoodBusinessError(null);
    setGoodBusinessAnalysis(null);
    setScorecardData(null);
    setMarkdownAnalysis(null);

    try {
      // Fetch financial statements
      const financialData = await getFinancialStatements(ticker);

      if (!financialData) {
        setGoodBusinessError('Failed to fetch financial statements. Please try again.');
        return;
      }

      // Analyze with Gemini
      const analysis = await analyzeGoodBusiness(ticker, financialData);
      const analyzedAt = new Date().toISOString();

      // Parse the response to extract JSON and markdown
      parseAnalysisResponse(analysis);

      // Save to database via backend API
      const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();
      const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

      await fetch(`${API_URL}/api/good_business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: normalizedTicker,
          analysis: analysis,
          created_at: analyzedAt
        })
      });

      setGoodBusinessAnalysis(analysis);
      setAnalysisDate(analyzedAt);
      
      // Refresh business scores in parent component
      // Trigger a custom event that App.tsx can listen to
      window.dispatchEvent(new CustomEvent('businessAnalysisUpdated', { 
        detail: { ticker: normalizedTicker } 
      }));
    } catch (err: any) {
      console.error('Error analyzing Good Business:', err);
      setGoodBusinessError(err.message || 'Failed to analyze. Please check your API key and try again.');
    } finally {
      setAnalyzingGoodBusiness(false);
    }
  };

  if (!ticker) return null;

  // Collapsed state - just show a button to expand
  if (!isExpanded) {
    return (
      <div className="mb-4">
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 hover:bg-slate-800/70 transition-colors flex items-center justify-between group"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
              Company Fundamentals
            </span>
            {loading && (
              <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
            )}
          </div>
          <svg className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-300">Company Fundamentals</h3>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-slate-400 hover:text-white transition-colors"
            title="Collapse"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
          <span className="text-sm text-slate-400">Loading company profile...</span>
        </div>
      </div>
    );
  }

  if (error || !fundamentals) {
    // Check if it's a crypto ticker
    const isCrypto = ticker?.startsWith('X:');

    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-300">Company Fundamentals</h3>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-slate-400 hover:text-white transition-colors"
            title="Collapse"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
        <div className="text-sm text-slate-400">
          {isCrypto
            ? 'Fundamental data is not available for crypto assets'
            : error || 'Fundamental data not available for this ticker. The ticker may not be found or the data source may be temporarily unavailable.'
          }
        </div>
      </div>
    );
  }

  const { name, sector, industry, bio, stats } = fundamentals;

  // Normalize ticker for Yahoo Finance URL (remove X: prefix for crypto)
  const normalizedTicker = ticker.replace(/^X:/, '').toUpperCase();

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-4">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">Company Fundamentals</h3>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-slate-400 hover:text-white transition-colors"
          title="Collapse panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4 min-w-0 w-full" style={{ width: '100%', maxWidth: '100%' }}>
        {/* Left Column: Existing Fundamentals */}
        <div className="flex flex-col min-w-0">
          {/* Company Name and Sector */}
          <div className="mb-3">
            <h4 className="text-lg font-bold text-white mb-1">{name}</h4>
            <div className="flex items-center gap-2 flex-wrap">
              {sector !== 'N/A' && (
                <span className="px-2 py-1 bg-indigo-600/20 text-indigo-300 text-xs font-semibold rounded">
                  {sector}
                </span>
              )}
              {industry !== 'N/A' && industry !== sector && (
                <span className="px-2 py-1 bg-slate-700/50 text-slate-300 text-xs rounded">
                  {industry}
                </span>
              )}
            </div>
          </div>

          {/* Bio Section */}
          {bio && bio !== 'N/A' && (
            <div className="mb-4">
              <p className={`text-sm text-slate-300 leading-relaxed ${!bioExpanded ? 'line-clamp-3' : ''}`}>
                {bio}
              </p>
              {bio.length > 300 && (
                <button
                  onClick={() => setBioExpanded(!bioExpanded)}
                  className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                >
                  {bioExpanded ? (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      Read Less
                    </>
                  ) : (
                    <>
                      Read More
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* P/E Ratio */}
            <StatBox
              label="P/E Ratio"
              value={stats.pe_ratio !== null ? stats.pe_ratio.toFixed(2) : 'N/A'}
              color="text-slate-300"
            />

            {/* Forward P/E */}
            <StatBox
              label="Forward P/E"
              value={stats.forward_pe !== null ? stats.forward_pe.toFixed(2) : 'N/A'}
              color="text-slate-300"
            />

            {/* Revenue */}
            <StatBox
              label="Revenue (TTM)"
              value={stats.revenue || 'N/A'}
              color="text-slate-300"
            />

            {/* Revenue Growth */}
            <StatBox
              label="Revenue Growth"
              value={
                stats.revenue_growth !== null
                  ? `${stats.revenue_growth > 0 ? '+' : ''}${stats.revenue_growth.toFixed(1)}%`
                  : 'N/A'
              }
              color={stats.revenue_growth !== null ? (stats.revenue_growth > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-300'}
            />

            {/* Debt to Equity */}
            <StatBox
              label="Debt/Equity"
              value={stats.debt_to_equity !== null ? stats.debt_to_equity.toFixed(2) : 'N/A'}
              color={
                stats.debt_to_equity !== null
                  ? stats.debt_to_equity > 2.0
                    ? 'text-red-400'
                    : stats.debt_to_equity > 1.0
                      ? 'text-yellow-400'
                      : 'text-emerald-400'
                  : 'text-slate-300'
              }
            />

            {/* Total Debt */}
            <StatBox
              label="Total Debt"
              value={stats.total_debt || 'N/A'}
              color="text-slate-300"
            />

            {/* PEG Ratio */}
            <StatBox
              label="PEG Ratio"
              value={stats.peg_ratio !== null ? stats.peg_ratio.toFixed(2) : 'N/A'}
              color="text-slate-300"
            />
          </div>

          {/* Yahoo Finance Link */}
          <div className="mt-auto pt-4 border-t border-slate-700">
            <a
              href={`https://finance.yahoo.com/quote/${normalizedTicker}/financials/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>View full financials on Yahoo Finance</span>
            </a>
          </div>
        </div>

        {/* Right Column: Good Business Analysis */}
        <div className="flex flex-col border-l border-slate-700 pl-4 min-w-0" style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-300">Good Business Analysis</h3>
              {analysisDate && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Analyzed: {new Date(analysisDate).toLocaleDateString()}
                </p>
              )}
            </div>
            {!analyzingGoodBusiness && (
              <button
                onClick={handleGoodBusinessAnalysis}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                title={goodBusinessAnalysis ? "Re-analyze" : "Analyze"}
              >
                {goodBusinessAnalysis ? "Refresh" : "Analyze"}
              </button>
            )}
          </div>

          {analyzingGoodBusiness && (
            <div className="flex items-center gap-2 py-8">
              <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              <span className="text-sm text-slate-400">Analyzing financial data...</span>
            </div>
          )}

          {goodBusinessError && (
            <div className="text-sm text-red-400 py-4">
              {goodBusinessError}
            </div>
          )}

          {goodBusinessAnalysis && (
            <div className="flex-1 overflow-y-auto overflow-x-auto max-h-[600px] pr-2 w-full min-w-0" style={{ width: '100%', maxWidth: '100%' }}>
              {/* JSON Scorecard at the top */}
              {scorecardData && (
                <div className="mb-6 bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-base font-bold text-white">
                      {scorecardData.ticker} - Good Business Scorecard
                    </h4>
                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${scorecardData.verdict?.is_good_business
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                      }`}>
                      {scorecardData.verdict?.score || 'N/A'}
                    </div>
                  </div>

                  {scorecardData.verdict?.summary && (
                    <p className="text-sm text-slate-300 mb-4">{scorecardData.verdict.summary}</p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {scorecardData.metrics && Object.entries(scorecardData.metrics).map(([key, metric]: [string, any]) => {
                      const labelMap: Record<string, string> = {
                        sales_growth_5y: 'Sales Growth (5Y)',
                        sales_growth_1y: 'Sales Growth (1Y)',
                        eps_growth_5y: 'EPS Growth (5Y)',
                        eps_growth_1y: 'EPS Growth (1Y)',
                        debt_to_equity: 'Debt/Equity',
                        roe: 'ROE',
                        peg_ratio: 'PEG Ratio'
                      };

                      return (
                        <div key={key} className="bg-slate-800/50 rounded p-2 border border-slate-700">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-400">{labelMap[key] || key}</span>
                            {metric.pass !== undefined && (
                              <span className={`text-xs ${metric.pass ? 'text-emerald-400' : 'text-red-400'}`}>
                                {metric.pass ? '✅' : '❌'}
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {typeof metric.value === 'number' ? metric.value.toFixed(2) : metric.value || 'N/A'}
                          </div>
                          {metric.raw_data && (
                            <div className="text-xs text-slate-400 mt-0.5">{metric.raw_data}</div>
                          )}
                          <div className="text-xs text-slate-500 mt-1">Target: {metric.target}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Markdown Analysis below */}
              {markdownAnalysis && markdownAnalysis.length > 0 && (
                <div className="w-full min-w-0" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                  <style>{`
                    .good-business-markdown * {
                      max-width: 100% !important;
                      word-wrap: break-word !important;
                      overflow-wrap: anywhere !important;
                      box-sizing: border-box !important;
                    }
                    .good-business-markdown table {
                      width: 100% !important;
                      max-width: 100% !important;
                      table-layout: auto !important;
                    }
                    .good-business-markdown td,
                    .good-business-markdown th {
                      word-break: break-word !important;
                      overflow-wrap: anywhere !important;
                      white-space: normal !important;
                    }
                  `}</style>
                  <div className="text-slate-300 text-sm good-business-markdown" style={{ 
                    width: '100%', 
                    maxWidth: '100%', 
                    wordWrap: 'break-word', 
                    overflowWrap: 'anywhere', 
                    boxSizing: 'border-box'
                  }}>
                    <ReactMarkdown
                      components={{
                        code: ({ children, className }) => {
                          // Skip rendering code blocks that look like JSON
                          const codeString = String(children).trim();
                          if (codeString.startsWith('{') && codeString.endsWith('}')) {
                            return null; // Don't render JSON code blocks
                          }
                          return (
                            <code className={className || 'bg-slate-800 px-1 py-0.5 rounded text-xs break-words'} style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                              {children}
                            </code>
                          );
                        },
                        pre: ({ children }) => {
                          // Skip rendering pre blocks that contain JSON
                          const content = String(children);
                          if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
                            return null; // Don't render JSON pre blocks
                          }
                          return <pre className="bg-slate-800 p-3 rounded break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{children}</pre>;
                        },
                        table: ({ children }) => (
                          <div className="my-4 w-full" style={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
                            <table className="w-full border-collapse border border-slate-600" style={{ 
                              width: '100%', 
                              maxWidth: '100%', 
                              tableLayout: 'auto',
                              wordBreak: 'break-word'
                            }}>
                              {children}
                            </table>
                          </div>
                        ),
                      thead: ({ children }) => (
                        <thead className="bg-slate-700">{children}</thead>
                      ),
                      tbody: ({ children }) => (
                        <tbody>{children}</tbody>
                      ),
                      tr: ({ children }) => (
                        <tr className="border-b border-slate-600">{children}</tr>
                      ),
                      th: ({ children }) => (
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 border border-slate-600" style={{ 
                          wordBreak: 'break-word', 
                          overflowWrap: 'anywhere',
                          whiteSpace: 'normal'
                        }}>
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-2 text-sm text-slate-300 border border-slate-600 align-top" style={{ 
                          wordBreak: 'break-word', 
                          overflowWrap: 'anywhere',
                          whiteSpace: 'normal'
                        }}>
                          {children}
                        </td>
                      ),
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold text-white mt-4 mb-2">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-white mt-3 mb-2">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-slate-200 mt-2 mb-1">{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className="text-sm text-slate-300 mb-2 leading-relaxed" style={{ 
                          wordBreak: 'break-word', 
                          overflowWrap: 'anywhere',
                          width: '100%',
                          maxWidth: '100%'
                        }}>{children}</p>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-white">{children}</strong>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc list-inside text-sm text-slate-300 mb-2 space-y-1">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-inside text-sm text-slate-300 mb-2 space-y-1">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="text-slate-300">{children}</li>
                      ),
                    }}
                  >
                      {markdownAnalysis}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Fallback: if no JSON parsed, show full markdown */}
              {!scorecardData && !markdownAnalysis && (
                <div className="w-full min-w-0" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                  <div className="text-slate-300 text-sm" style={{ 
                    width: '100%', 
                    maxWidth: '100%', 
                    wordWrap: 'break-word', 
                    overflowWrap: 'anywhere',
                    boxSizing: 'border-box'
                  }}>
                    <ReactMarkdown
                      components={{
                        table: ({ children }) => (
                          <div className="my-4 w-full" style={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
                            <table className="w-full border-collapse border border-slate-600" style={{ 
                              width: '100%', 
                              maxWidth: '100%', 
                              tableLayout: 'auto',
                              wordBreak: 'break-word'
                            }}>
                              {children}
                            </table>
                          </div>
                        ),
                      thead: ({ children }) => (
                        <thead className="bg-slate-700">{children}</thead>
                      ),
                      tbody: ({ children }) => (
                        <tbody>{children}</tbody>
                      ),
                      tr: ({ children }) => (
                        <tr className="border-b border-slate-600">{children}</tr>
                      ),
                      th: ({ children }) => (
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 border border-slate-600" style={{ 
                          wordBreak: 'break-word', 
                          overflowWrap: 'anywhere',
                          whiteSpace: 'normal'
                        }}>
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-2 text-sm text-slate-300 border border-slate-600 align-top" style={{ 
                          wordBreak: 'break-word', 
                          overflowWrap: 'anywhere',
                          whiteSpace: 'normal'
                        }}>
                          {children}
                        </td>
                      ),
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold text-white mt-4 mb-2 break-words" style={{ wordBreak: 'break-word' }}>{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-white mt-3 mb-2 break-words" style={{ wordBreak: 'break-word' }}>{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-slate-200 mt-2 mb-1 break-words" style={{ wordBreak: 'break-word' }}>{children}</h3>
                      ),
                        p: ({ children }) => (
                          <p className="text-sm text-slate-300 mb-2 leading-relaxed" style={{ 
                            wordBreak: 'break-word', 
                            overflowWrap: 'anywhere',
                            width: '100%',
                            maxWidth: '100%'
                          }}>{children}</p>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold text-white" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</strong>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside text-sm text-slate-300 mb-2 space-y-1" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside text-sm text-slate-300 mb-2 space-y-1" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</ol>
                        ),
                        li: ({ children }) => (
                          <li className="text-slate-300" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</li>
                        ),
                      }}
                    >
                      {goodBusinessAnalysis}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {!goodBusinessAnalysis && !analyzingGoodBusiness && !goodBusinessError && (
            <div className="text-sm text-slate-400 py-8 text-center">
              Click "Analyze" to run the Good Business analysis
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface StatBoxProps {
  label: string;
  value: string;
  color: string;
}

const StatBox: React.FC<StatBoxProps> = ({ label, value, color }) => {
  return (
    <div className="bg-slate-900/50 rounded-lg p-2.5 border border-slate-700/50">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
};

export default CompanyProfile;
