import { Hono } from 'hono'
import { mppx } from '../mpp.js'
import { searchWeb } from '../services/search.js'
import { logTransaction } from '../store.js'

const app = new Hono()

app.get('/', async (c) => {
  let result
  try {
    result = await mppx.charge({
      amount: '0.01',
      description: 'Web search - 0.01 USDC per query',
    })(c.req.raw)
  } catch (err: any) {
    console.error('[search] MPP charge failed:', err?.message ?? err)
    if (err?.cause) console.error('  cause:', err.cause)
    if (err?.stack) console.error(err.stack)
    return c.json({ error: `MPP charge failed: ${err?.message ?? err}` }, 500)
  }

  if (result.status === 402) return result.challenge

  const q = c.req.query('q')
  if (!q) return c.json({ error: 'Missing query param ?q=' }, 400)

  try {
    const data = await searchWeb(q)
    logTransaction({ service: 'search', amount: '0.01', query: q })
    return result.withReceipt(Response.json(data))
  } catch (err: any) {
    console.error('[search] searchWeb failed:', err?.message ?? err)
    return c.json({ error: err.message }, 500)
  }
})

export default app
