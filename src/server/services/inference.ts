export interface InferenceResult {
  model: string
  prompt: string
  text: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  source: 'gemini' | 'mock'
  timestamp: string
}

export async function runInference(
  prompt: string,
  model?: string,
): Promise<InferenceResult> {
  if (process.env.GEMINI_API_KEY) {
    return runGemini(prompt, model)
  }
  return runMock(prompt, model)
}

async function runGemini(prompt: string, model?: string): Promise<InferenceResult> {
  const selectedModel = model ?? 'gemini-2.0-flash'
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
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

// Graceful fallback when GEMINI_API_KEY is not set
function runMock(prompt: string, model?: string): InferenceResult {
  return {
    model: model ?? 'gemini-2.0-flash',
    prompt,
    text: '[GEMINI_API_KEY not configured — set it in .env to enable real inference]',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    source: 'mock',
    timestamp: new Date().toISOString(),
  }
}