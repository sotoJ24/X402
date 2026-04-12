export interface InferenceResult {
  model: string
  prompt: string
  text: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  source: 'gemini' | 'openrouter' | 'mock'
  timestamp: string
}

export async function runInference(
  prompt: string,
  model?: string,
): Promise<InferenceResult> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim()

  if (geminiKey) {
    try {
      return await runGemini(prompt, model)
    } catch (err) {
      console.warn('[inference] Gemini failed, falling back:', (err as Error).message)
    }
  }
  if (openrouterKey) {
    try {
      return await runOpenRouter(prompt, model)
    } catch (err) {
      console.warn('[inference] OpenRouter failed, falling back:', (err as Error).message)
    }
  }
  return runMock(prompt, model)
}

async function runGemini(prompt: string, model?: string): Promise<InferenceResult> {
  const selectedModel = model ?? 'gemini-2.0-flash'
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GEMINI_API_KEY!.trim()}`,
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  const data = (await res.json()) as any
  const choice = data.choices?.[0]

  return {
    model: data.model ?? selectedModel,
    prompt,
    text: choice?.message?.content ?? '',
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    },
    source: 'gemini',
    timestamp: new Date().toISOString(),
  }
}

async function runOpenRouter(prompt: string, model?: string): Promise<InferenceResult> {
  const selectedModel = model ?? 'google/gemini-2.0-flash-001'
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!.trim()}`,
      'HTTP-Referer': 'https://github.com/OFFER-HUB/X402',
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter API error ${res.status}: ${err}`)
  }

  const data = (await res.json()) as any
  const choice = data.choices?.[0]

  return {
    model: data.model ?? selectedModel,
    prompt,
    text: choice?.message?.content ?? '',
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    },
    source: 'openrouter',
    timestamp: new Date().toISOString(),
  }
}

// Graceful fallback when no API key is configured
function runMock(prompt: string, model?: string): InferenceResult {
  return {
    model: model ?? 'gemini-2.0-flash',
    prompt,
    text: '[No inference API key configured — set GEMINI_API_KEY or OPENROUTER_API_KEY in .env]',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    source: 'mock',
    timestamp: new Date().toISOString(),
  }
}