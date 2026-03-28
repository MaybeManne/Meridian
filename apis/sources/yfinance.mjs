// Yahoo Finance — Live market quotes (no API key required)
// Provides real-time prices for stocks, ETFs, crypto, commodities
// Replaces the need for Alpaca or any paid market data provider

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Symbols to track — covers broad market, rates, commodities, crypto, volatility
// Plus terminal bar tickers for energy, defense, and precious metals
const SYMBOLS = {
  // Indexes / ETFs
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  DIA: 'Dow Jones',
  IWM: 'Russell 2000',
  // Energy
  XOM: 'ExxonMobil',
  CVX: 'Chevron',
  HAL: 'Halliburton',
  XLE: 'Energy Select',
  USO: 'US Oil Fund',
  // Defense
  LMT: 'Lockheed Martin',
  RTX: 'Raytheon',
  NOC: 'Northrop Grumman',
  GD: 'General Dynamics',
  // Precious Metals
  GLD: 'Gold ETF',
  SLV: 'Silver ETF',
  // Rates / Credit
  TLT: '20Y+ Treasury',
  HYG: 'High Yield Corp',
  LQD: 'IG Corporate',
  // Dollar
  UUP: 'US Dollar ETF',
  // Commodities (futures)
  'GC=F': 'Gold',
  'SI=F': 'Silver',
  'CL=F': 'WTI Crude',
  'BZ=F': 'Brent Crude',
  'NG=F': 'Natural Gas',
  // Crypto
  'BTC-USD': 'Bitcoin',
  'ETH-USD': 'Ethereum',
  // Volatility
  '^VIX': 'VIX',
};

async function fetchQuote(symbol) {
  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
    const data = await safeFetch(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const timestamps = result.timestamp || [];

    // Get current price and previous close
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2];
    const change = price && prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    // Build 5-day history
    const history = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        history.push({
          date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
          close: Math.round(closes[i] * 100) / 100,
        });
      }
    }

    return {
      symbol,
      name: SYMBOLS[symbol] || meta.shortName || symbol,
      price: Math.round(price * 100) / 100,
      prevClose: Math.round((prevClose || 0) * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      marketState: meta.marketState || 'UNKNOWN',
      history,
    };
  } catch (e) {
    return { symbol, name: SYMBOLS[symbol] || symbol, error: e.message };
  }
}

export async function briefing() {
  return collect();
}

export async function collect() {
  const symbols = Object.keys(SYMBOLS);
  const results = await Promise.allSettled(
    symbols.map(s => fetchQuote(s))
  );

  const quotes = {};
  let ok = 0;
  let failed = 0;

  for (const r of results) {
    const q = r.status === 'fulfilled' ? r.value : null;
    if (q && !q.error) {
      quotes[q.symbol] = q;
      ok++;
    } else {
      failed++;
      const sym = q?.symbol || 'unknown';
      quotes[sym] = q || { symbol: sym, error: 'fetch failed' };
    }
  }

  // Build flat prices map for stock terminal bar
  const prices = {};
  let marketState = 'CLOSED';
  for (const [sym, q] of Object.entries(quotes)) {
    if (!q || q.error) continue;
    // Normalize symbol for terminal display (remove =F suffix, etc.)
    const displaySym = sym.replace('=F', '').replace('-USD', '').replace('^', '');
    prices[displaySym] = {
      price: q.price,
      previousClose: q.prevClose,
      change: q.change,
      changePercent: q.changePct,
      marketState: q.marketState,
    };
    // Also keep original symbol key
    prices[sym] = prices[displaySym];
    if (q.marketState === 'REGULAR') marketState = 'REGULAR';
    else if (q.marketState === 'PRE' && marketState !== 'REGULAR') marketState = 'PRE';
    else if (q.marketState === 'POST' && marketState !== 'REGULAR' && marketState !== 'PRE') marketState = 'POST';
  }

  // Categorize for easy dashboard consumption
  return {
    quotes,
    prices,
    marketState,
    summary: {
      totalSymbols: symbols.length,
      ok,
      failed,
      timestamp: new Date().toISOString(),
    },
    indexes: pickGroup(quotes, ['SPY', 'QQQ', 'DIA', 'IWM']),
    rates: pickGroup(quotes, ['TLT', 'HYG', 'LQD']),
    commodities: pickGroup(quotes, ['GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F']),
    crypto: pickGroup(quotes, ['BTC-USD', 'ETH-USD']),
    volatility: pickGroup(quotes, ['^VIX']),
    energy: pickGroup(quotes, ['XOM', 'CVX', 'HAL', 'XLE', 'USO']),
    defense: pickGroup(quotes, ['LMT', 'RTX', 'NOC', 'GD']),
    metals: pickGroup(quotes, ['GLD', 'SLV']),
  };
}

function pickGroup(quotes, symbols) {
  return symbols.map(s => quotes[s]).filter(Boolean);
}
