import { Hono } from 'hono'
import { mppx } from '../mpp.js'
import { runInference } from '../services/inference.js'
import { logTransaction } from '../store.js'

const app = new Hono()

app.post('/', async (c) => {
  let result
  try {
    result = await mppx.charge({
      amount: '0.005',
      description: 'AI inference - 0.005 USDC per request',
    })(c.req.raw)
  } catch (err: any) {
    console.error('[inference] MPP charge failed:', err?.message ?? err)
    if (err?.stack) console.error(err.stack)
    return c.json({ error: `MPP charge failed: ${err?.message ?? err}` }, 500)
  }

  if (result.status === 402) return result.challenge

  const body = await c.req.json().catch(() => null)
  if (!body?.prompt) return c.json({ error: 'Missing prompt' }, 400)

  const { prompt, model } = body

  try {
    const data = await runInference(prompt, model)
    logTransaction({
      service: 'inference',
      amount: '0.005',
      query: prompt.slice(0, 50),
    })
    return result.withReceipt(Response.json(data))
  } catch (err: any) {
    console.error('[inference] runInference failed:', err?.message ?? err)
    return c.json({ error: err.message }, 500)
  }
})

export default app