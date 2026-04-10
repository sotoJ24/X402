import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the mpp modules so session.ts can be imported without env vars / Stellar
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
vi.mock('../server/mpp.js', () => ({ network: 'testnet' }))

let createSession: any
let recordUsage: any
let closeSession: any
let markSettled: any
let getSession: any
let getAllSessions: any

beforeEach(async () => {
  vi.resetModules()
  // Re-apply mocks after reset
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
  vi.mock('../server/mpp.js', () => ({ network: 'testnet' }))

  const mod = await import('../server/session.js')
  createSession = mod.createSession
  recordUsage = mod.recordUsage
  closeSession = mod.closeSession
  markSettled = mod.markSettled
  getSession = mod.getSession
  getAllSessions = mod.getAllSessions
})

describe('createSession', () => {
  it('creates a session with correct initial shape', () => {
    const s = createSession('sess-1', 'GABC', '1000000')
    expect(s.sessionId).toBe('sess-1')
    expect(s.agentPublicKey).toBe('GABC')
    expect(s.depositAmount).toBe('1000000')
    expect(s.usedAmount).toBe('0')
    expect(s.requestCount).toBe(0)
    expect(s.status).toBe('open')
    expect(s.openedAt).toBeTruthy()
    expect(s.events).toHaveLength(1)
    expect(s.events[0].type).toBe('opened')
  })

  it('stores the session so getSession can retrieve it', () => {
    createSession('sess-2', 'GDEF', '500000')
    const found = getSession('sess-2')
    expect(found).toBeDefined()
    expect(found!.agentPublicKey).toBe('GDEF')
  })
})

describe('recordUsage', () => {
  it('increments requestCount and updates usedAmount', () => {
    createSession('sess-3', 'G1', '1000000')
    const updated = recordUsage('sess-3', '0.0100')
    expect(updated).not.toBeNull()
    expect(updated!.requestCount).toBe(1)
    expect(updated!.usedAmount).toBe('0.0100')
    expect(updated!.events).toHaveLength(2)
    expect(updated!.events[1].type).toBe('used')
  })

  it('accumulates multiple usages', () => {
    createSession('sess-4', 'G2', '1000000')
    recordUsage('sess-4', '0.0100')
    const updated = recordUsage('sess-4', '0.0200')
    expect(updated!.requestCount).toBe(2)
    expect(updated!.usedAmount).toBe('0.0200')
  })

  it('returns null for unknown session', () => {
    expect(recordUsage('no-such-id', '0.01')).toBeNull()
  })

  it('returns null when session is not open', () => {
    createSession('sess-5', 'G3', '1000000')
    closeSession('sess-5')
    expect(recordUsage('sess-5', '0.01')).toBeNull()
  })
})

describe('closeSession', () => {
  it('sets status to closed and records closedAt', () => {
    createSession('sess-6', 'G4', '1000000')
    const closed = closeSession('sess-6')
    expect(closed).not.toBeNull()
    expect(closed!.status).toBe('closed')
    expect(closed!.closedAt).toBeTruthy()
    expect(closed!.events.at(-1)!.type).toBe('closed')
  })

  it('returns null for unknown session', () => {
    expect(closeSession('missing')).toBeNull()
  })

  it('returns null when session is already closed', () => {
    createSession('sess-7', 'G5', '1000000')
    closeSession('sess-7')
    expect(closeSession('sess-7')).toBeNull()
  })
})

describe('markSettled', () => {
  it('sets status to settled', () => {
    createSession('sess-8', 'G6', '1000000')
    closeSession('sess-8')
    const settled = markSettled('sess-8')
    expect(settled).not.toBeNull()
    expect(settled!.status).toBe('settled')
    expect(settled!.events.at(-1)!.type).toBe('settled')
  })

  it('returns null for unknown session', () => {
    expect(markSettled('ghost')).toBeNull()
  })

  it('can settle directly from open (edge case)', () => {
    createSession('sess-9', 'G7', '1000000')
    const settled = markSettled('sess-9')
    expect(settled!.status).toBe('settled')
  })
})

describe('getAllSessions', () => {
  it('returns empty array when no sessions exist', () => {
    expect(getAllSessions()).toEqual([])
  })

  it('returns all created sessions', () => {
    createSession('a', 'G1', '100')
    createSession('b', 'G2', '200')
    const all = getAllSessions()
    expect(all).toHaveLength(2)
    expect(all.map((s: any) => s.sessionId).sort()).toEqual(['a', 'b'])
  })
})
