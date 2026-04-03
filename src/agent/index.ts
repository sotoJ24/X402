import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { Keypair } from '@stellar/stellar-sdk'
import { Mppx, stellar } from '@stellar/mpp/charge/client'

// ── MPP client setup ──────────────────────────────────────────────────────────
// Patches global fetch() to automatically intercept 402 responses,
// sign the payment on Stellar, and retry — no manual payment logic needed.
Mppx.create({
  methods: [
    stellar.charge({
      keypair: Keypair.fromSecret(process.env.AGENT_SECRET_KEY!),
    }),
  ],
})

const anthropic = new Anthropic()
const BASE_URL = process.env.SERVER_URL || 'http://localhost:3000'

// Track spending per tool call
const spending: Record<string, { calls: number; usdc: number }> = {}

// ── Tool definitions ──────────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current information. Costs 0.01 USDC per query via Stellar MPP — payment is automatic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_stock_quote',
    description:
      'Get real-time stock price and financial data. Costs 0.001 USDC per request via Stellar MPP.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol, e.g. NVDA, AAPL, TSLA' },
      },
      required: ['symbol'],
    },
  },
]

// ── Tool execution (fetch() handles 402 payment automatically) ────────────────
async function callTool(name: string, input: Record<string, string>): Promise<unknown> {
  if (name === 'web_search') {
    const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(input.query)}`)
    if (!res.ok) throw new Error(`Search failed: ${res.status}`)
    trackSpend('web_search', 0.01)
    return res.json()
  }

  if (name === 'get_stock_quote') {
    const res = await fetch(`${BASE_URL}/finance/quote?symbol=${encodeURIComponent(input.symbol)}`)
    if (!res.ok) throw new Error(`Finance failed: ${res.status}`)
    trackSpend('get_stock_quote', 0.001)
    return res.json()
  }

  throw new Error(`Unknown tool: ${name}`)
}

function trackSpend(tool: string, amount: number) {
  if (!spending[tool]) spending[tool] = { calls: 0, usdc: 0 }
  spending[tool].calls++
  spending[tool].usdc += amount
}

// ── Agent loop ────────────────────────────────────────────────────────────────
async function runAgent(question: string) {
  console.log(`\n🤖 Question: ${question}\n${'─'.repeat(60)}`)

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: question },
  ]

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    // Agent is done
    if (response.stop_reason === 'end_turn') {
      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      console.log(`\n📊 Answer:\n${'─'.repeat(60)}\n${text?.text ?? '(no text)'}`)
      printSpendingSummary()
      break
    }

    // Agent wants to use tools
    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue

        const price = block.name === 'web_search' ? '0.01' : '0.001'
        console.log(`\n💳 Calling tool: ${block.name}`)
        console.log(`   Input: ${JSON.stringify(block.input)}`)
        console.log(`   💰 Paying ${price} USDC via Stellar MPP...`)

        try {
          const result = await callTool(block.name, block.input as Record<string, string>)
          console.log(`   ✅ Done`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        } catch (err: any) {
          console.error(`   ❌ Error: ${err.message}`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${err.message}`,
            is_error: true,
          })
        }
      }

      messages.push({ role: 'user', content: toolResults })
    }
  }
}

function printSpendingSummary() {
  const total = Object.values(spending).reduce((sum, s) => sum + s.usdc, 0)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`💰 Spending summary:`)
  for (const [tool, s] of Object.entries(spending)) {
    console.log(`   ${tool}: ${s.calls} call(s) × → ${s.usdc.toFixed(4)} USDC`)
  }
  console.log(`   Total: ${total.toFixed(4)} USDC`)
  console.log(`${'─'.repeat(60)}\n`)
}

// ── Run demo ──────────────────────────────────────────────────────────────────
const question =
  process.argv[2] ??
  'Is Nvidia a good investment right now? Search for the latest news and get the current stock price, then give me a brief analysis.'

runAgent(question).catch(console.error)
