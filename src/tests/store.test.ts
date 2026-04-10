import { describe, it, expect, beforeEach, vi } from 'vitest'

// Reset module state between tests so each test gets a clean store
let logTransaction: (tx: any) => void
let getTransactions: () => any[]
let getStats: () => any
let txEvents: any

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('../server/store.js')
  logTransaction = mod.logTransaction
  getTransactions = mod.getTransactions
  getStats = mod.getStats
  txEvents = mod.txEvents
})

describe('logTransaction', () => {
  it('adds an id and timestamp automatically', () => {
    logTransaction({ service: 'search', amount: '0.01', query: 'bitcoin' })
    const [tx] = getTransactions()
    expect(tx.id).toBeTruthy()
    expect(tx.timestamp).toBeTruthy()
    expect(new Date(tx.timestamp).toString()).not.toBe('Invalid Date')
  })

  it('stores the supplied fields verbatim', () => {
    logTransaction({ service: 'finance', amount: '0.001', query: 'NVDA', txHash: 'abc123' })
    const [tx] = getTransactions()
    expect(tx.service).toBe('finance')
    expect(tx.amount).toBe('0.001')
    expect(tx.query).toBe('NVDA')
    expect(tx.txHash).toBe('abc123')
  })

  it('prepends new transactions (most recent first)', () => {
    logTransaction({ service: 'search', amount: '0.01', query: 'first' })
    logTransaction({ service: 'search', amount: '0.01', query: 'second' })
    const txs = getTransactions()
    expect(txs[0].query).toBe('second')
    expect(txs[1].query).toBe('first')
  })

  it('keeps at most 100 transactions', () => {
    for (let i = 0; i < 110; i++) {
      logTransaction({ service: 'search', amount: '0.01', query: `q${i}` })
    }
    expect(getTransactions()).toHaveLength(100)
  })

  it('emits a "new" event with the full transaction', () => {
    const handler = vi.fn()
    txEvents.on('new', handler)
    logTransaction({ service: 'inference', amount: '0.005', query: 'hello' })
    expect(handler).toHaveBeenCalledOnce()
    const emitted = handler.mock.calls[0][0]
    expect(emitted.service).toBe('inference')
    expect(emitted.id).toBeTruthy()
  })
})

describe('getTransactions', () => {
  it('returns empty array initially', () => {
    expect(getTransactions()).toEqual([])
  })

  it('returns all logged transactions', () => {
    logTransaction({ service: 'search', amount: '0.01', query: 'a' })
    logTransaction({ service: 'finance', amount: '0.001', query: 'b' })
    expect(getTransactions()).toHaveLength(2)
  })
})

describe('getStats', () => {
  it('returns zeros on empty store', () => {
    const stats = getStats()
    expect(stats.totalUsdc).toBe('0.0000')
    expect(stats.totalCalls).toBe(0)
    expect(stats.services).toEqual({})
  })

  it('aggregates calls and USDC per service', () => {
    logTransaction({ service: 'search', amount: '0.01', query: 'a' })
    logTransaction({ service: 'search', amount: '0.01', query: 'b' })
    logTransaction({ service: 'finance', amount: '0.001', query: 'AAPL' })

    const stats = getStats()
    expect(stats.totalCalls).toBe(3)
    expect(parseFloat(stats.totalUsdc)).toBeCloseTo(0.021, 4)
    expect(stats.services.search.calls).toBe(2)
    expect(stats.services.search.usdc).toBeCloseTo(0.02, 4)
    expect(stats.services.finance.calls).toBe(1)
    expect(stats.services.finance.usdc).toBeCloseTo(0.001, 4)
  })

  it('totalUsdc is formatted to 4 decimal places', () => {
    logTransaction({ service: 'search', amount: '0.01', query: 'test' })
    const { totalUsdc } = getStats()
    expect(totalUsdc).toMatch(/^\d+\.\d{4}$/)
  })
})
