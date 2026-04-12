export interface StockQuote {
  symbol: string
  name: string | null
  price: number | null
  change: number | null
  changePercent: number | null
  volume: number | null
  marketCap: number | null
  currency: string | null
  timestamp: string
}

// ── Provider 1: Yahoo Finance (works locally, often blocked on cloud) ─────────
async function fromYahoo(ticker: string): Promise<StockQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; stockbot/1.0)' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`)
  const data = (await res.json()) as any
  const result = data.chart?.result?.[0]
  if (!result) throw new Error(`No data found for symbol: ${ticker}`)
  const meta = result.meta
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null
  const price: number | null = meta.regularMarketPrice ?? null
  const change = price !== null && prevClose != null ? price - prevClose : null
  const changePercent = change !== null && prevClose ? (change / prevClose) * 100 : null
  return {
    symbol: meta.symbol ?? ticker,
    name: null,
    price,
    change,
    changePercent,
    volume: meta.regularMarketVolume ?? null,
    marketCap: null,
    currency: meta.currency ?? null,
    timestamp: new Date().toISOString(),
  }
}

// ── Provider 2: Finnhub (free tier, no key needed for basic quotes) ───────────
async function fromFinnhub(ticker: string): Promise<StockQuote> {
  const apiKey = process.env.FINNHUB_API_KEY ?? 'demo'
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Finnhub returned ${res.status} for ${ticker}`)
  const data = (await res.json()) as any
  if (!data.c || data.c === 0) throw new Error(`No Finnhub data for ${ticker}`)
  const price = data.c
  const prevClose = data.pc
  const change = price - prevClose
  const changePercent = prevClose ? (change / prevClose) * 100 : null
  return {
    symbol: ticker,
    name: null,
    price,
    change,
    changePercent,
    volume: null,
    marketCap: null,
    currency: 'USD',
    timestamp: new Date().toISOString(),
  }
}

// ── Provider 3: Alpha Vantage (free tier with key) ────────────────────────────
async function fromAlphaVantage(ticker: string): Promise<StockQuote> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  if (!apiKey) throw new Error('No ALPHA_VANTAGE_API_KEY set')
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`Alpha Vantage returned ${res.status}`)
  const data = (await res.json()) as any
  const q = data['Global Quote']
  if (!q || !q['05. price']) throw new Error(`No Alpha Vantage data for ${ticker}`)
  return {
    symbol: ticker,
    name: null,
    price: parseFloat(q['05. price']),
    change: parseFloat(q['09. change']),
    changePercent: parseFloat(q['10. change percent']),
    volume: parseInt(q['06. volume']),
    marketCap: null,
    currency: 'USD',
    timestamp: new Date().toISOString(),
  }
}

// ── Main: try providers in order ──────────────────────────────────────────────
export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const ticker = symbol.toUpperCase()
  const providers = [
    { name: 'Yahoo', fn: () => fromYahoo(ticker) },
    { name: 'Finnhub', fn: () => fromFinnhub(ticker) },
    { name: 'AlphaVantage', fn: () => fromAlphaVantage(ticker) },
  ]

  const errors: string[] = []
  for (const { name, fn } of providers) {
    try {
      const quote = await fn()
      if (quote.price !== null) {
        console.log(`[finance] ${ticker} resolved via ${name}`)
        return quote
      }
    } catch (err: any) {
      console.warn(`[finance] ${name} failed for ${ticker}: ${err.message}`)
      errors.push(`${name}: ${err.message}`)
    }
  }

  throw new Error(`All finance providers failed for ${ticker}: ${errors.join(' | ')}`)
}