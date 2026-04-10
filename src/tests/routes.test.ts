import { describe, it, expect, vi, beforeAll } from 'vitest'
import { Hono } from 'hono'

// ── Top-level mocks (hoisted by vitest) ──────────────────────────────────────

vi.mock('@stellar/mpp/charge/server', () => ({
  Mppx: { create: vi.fn(() => ({})) },
  stellar: { charge: vi.fn(() => ({})) },
}))

vi.mock('@stellar/mpp', () => ({
  USDC_SAC_TESTNET: 'USDC_TESTNET',
  USDC_SAC_MAINNET: 'USDC_MAINNET',
  STELLAR_TESTNET: 'stellar:testnet',
  STELLAR_PUBNET: 'stellar:pubnet',
}))

// Bypass payment on every charge: always return status 200 + identity receipt
const mockCharge = vi.fn(() => async (_req: Request) => ({
  status: 200 as const,
  challenge: new Response('payment required', { status: 402 }),
  withReceipt: (res: Response) => res,
}))

vi.mock('../server/mpp.js', () => ({
  network: 'testnet',
  mppx: { charge: mockCharge },
}))

vi.mock('../server/session.js', async () => {
  const actual = await vi.importActual<typeof import('../server/session.js')>('../server/session.js')
  return {
    ...actual,
    mppSession: { charge: mockCharge },
  }
})

vi.mock('../server/services/search.js', () => ({
  searchWeb: vi.fn(async (q: string) => ({
    query: q,
    results: [{ title: 'Result', url: 'https://example.com', description: 'desc' }],
    source: 'jina',
    timestamp: new Date().toISOString(),
  })),
}))

vi.mock('../server/services/finance.js', () => ({
  getStockQuote: vi.fn(async (symbol: string) => ({
    symbol,
    name: 'Test Corp',
    price: 100,
    change: 1,
    changePercent: 1,
    volume: 1000,
    marketCap: 1e9,
    currency: 'USD',
    timestamp: new Date().toISOString(),
  })),
}))

vi.mock('../server/services/inference.js', () => ({
  runInference: vi.fn(async (prompt: string) => ({
    model: 'mock',
    prompt,
    text: 'Mock response',
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    source: 'mock',
    timestamp: new Date().toISOString(),
  })),
}))

// ── Load routes after mocks are in place ─────────────────────────────────────

let searchRoute: Hono
let financeRoute: Hono
let inferenceRoute: Hono
let sessionRoute: Hono

beforeAll(async () => {
  const [search, finance, inference, session] = await Promise.all([
    import('../server/routes/search.js'),
    import('../server/routes/finance.js'),
    import('../server/routes/inference.js'),
    import('../server/routes/search-session.js'),
  ])
  searchRoute = new Hono().route('/search', search.default)
  financeRoute = new Hono().route('/finance', finance.default)
  inferenceRoute = new Hono().route('/inference', inference.default)
  sessionRoute = new Hono().route('/session/search', session.default)
})

async function json(res: Response) {
  return res.json()
}

// ── Search ────────────────────────────────────────────────────────────────────

describe('GET /search', () => {
  it('returns 400 when ?q is missing', async () => {
    const res = await searchRoute.request('/search')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/missing/i)
  })

  it('returns search results for a valid query', async () => {
    const res = await searchRoute.request('/search?q=typescript')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.query).toBe('typescript')
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.source).toBeTruthy()
  })

  it('encodes special characters in query correctly', async () => {
    const res = await searchRoute.request('/search?q=hello+world')
    expect(res.status).toBe(200)
  })
})

// ── Finance ───────────────────────────────────────────────────────────────────

describe('GET /finance/quote', () => {
  it('returns 400 when ?symbol is missing', async () => {
    const res = await financeRoute.request('/finance/quote')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/missing/i)
  })

  it('returns a quote for a valid symbol', async () => {
    const res = await financeRoute.request('/finance/quote?symbol=NVDA')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.symbol).toBe('NVDA')
    expect(typeof body.price).toBe('number')
  })

  it('returns a quote for lowercase symbol', async () => {
    const res = await financeRoute.request('/finance/quote?symbol=aapl')
    expect(res.status).toBe(200)
  })
})

// ── Inference ─────────────────────────────────────────────────────────────────

describe('POST /inference', () => {
  it('returns 400 when prompt is missing', async () => {
    const res = await inferenceRoute.request('/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test' }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/prompt/i)
  })

  it('returns 400 on non-JSON body', async () => {
    const res = await inferenceRoute.request('/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  it('returns inference result for valid prompt', async () => {
    const res = await inferenceRoute.request('/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello world' }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.prompt).toBe('Hello world')
    expect(body.text).toBeTruthy()
    expect(body.usage).toBeDefined()
  })

  it('accepts optional model field', async () => {
    const res = await inferenceRoute.request('/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', model: 'gemini-2.0-flash' }),
    })
    expect(res.status).toBe(200)
  })
})

// ── Session lifecycle ─────────────────────────────────────────────────────────

describe('Session routes', () => {
  it('POST /open creates a session', async () => {
    const res = await sessionRoute.request('/session/search/open', {
      method: 'POST',
      headers: { 'x-agent-public-key': 'GABC', 'x-deposit-amount': '1000000' },
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.sessionId).toBeTruthy()
    expect(body.status).toBe('open')
    expect(body.depositAmount).toBe('1000000')
    expect(body.openedAt).toBeTruthy()
  })

  it('POST /open uses defaults when headers are absent', async () => {
    const res = await sessionRoute.request('/session/search/open', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.depositAmount).toBe('0')
  })

  it('POST / returns 400 when sessionId is missing', async () => {
    const res = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'test' }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/sessionId/i)
  })

  it('POST / returns 400 when query is missing', async () => {
    const openRes = await sessionRoute.request('/session/search/open', { method: 'POST' })
    const { sessionId } = await openRes.json()

    const res = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error).toMatch(/query/i)
  })

  it('POST / returns 404 for unknown session', async () => {
    const res = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'does-not-exist', q: 'test' }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /:sessionId returns 404 for unknown session', async () => {
    const res = await sessionRoute.request('/session/search/ghost-id')
    expect(res.status).toBe(404)
  })

  it('full lifecycle: open → search → state → close', async () => {
    // Open
    const openRes = await sessionRoute.request('/session/search/open', {
      method: 'POST',
      headers: { 'x-agent-public-key': 'GTEST', 'x-deposit-amount': '5000000' },
    })
    expect(openRes.status).toBe(200)
    const { sessionId } = await openRes.json()

    // Search
    const searchRes = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, q: 'stellar blockchain' }),
    })
    expect(searchRes.status).toBe(200)
    const searchBody = await searchRes.json()
    expect(searchBody.session.requestCount).toBe(1)
    expect(searchBody.session.sessionId).toBe(sessionId)

    // State
    const stateRes = await sessionRoute.request(`/session/search/${sessionId}`)
    expect(stateRes.status).toBe(200)
    const stateBody = await stateRes.json()
    expect(stateBody.requestCount).toBe(1)
    expect(stateBody.status).toBe('open')

    // Second search
    const searchRes2 = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, q: 'second query' }),
    })
    expect(searchRes2.status).toBe(200)
    const s2 = await searchRes2.json()
    expect(s2.session.requestCount).toBe(2)

    // Close
    const closeRes = await sessionRoute.request('/session/search/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    expect(closeRes.status).toBe(200)
    const closeBody = await closeRes.json()
    expect(closeBody.status).toBe('settled')
    expect(closeBody.requestCount).toBe(2)
  })

  it('cannot search on a settled session', async () => {
    const openRes = await sessionRoute.request('/session/search/open', { method: 'POST' })
    const { sessionId } = await openRes.json()

    await sessionRoute.request('/session/search/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })

    const searchRes = await sessionRoute.request('/session/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, q: 'test' }),
    })
    expect(searchRes.status).toBe(400)
    const body = await searchRes.json()
    expect(body.error).toMatch(/settled/i)
  })

  it('POST /close returns 400 when sessionId is missing', async () => {
    const res = await sessionRoute.request('/session/search/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /close returns 404 for unknown session', async () => {
    const res = await sessionRoute.request('/session/search/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown' }),
    })
    expect(res.status).toBe(404)
  })
})
