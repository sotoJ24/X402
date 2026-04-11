export interface SearchResult {
  title: string
  url: string
  description: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  source: 'brave' | 'jina' | 'duckduckgo'
  timestamp: string
}

export async function searchWeb(query: string): Promise<SearchResponse> {
  if (process.env.BRAVE_API_KEY) {
    try {
      return await searchBrave(query)
    } catch (err) {
      console.warn('[search] Brave failed, falling back:', (err as Error).message)
    }
  }
  if (process.env.JINA_API_KEY) {
    try {
      return await searchJina(query)
    } catch (err) {
      console.warn('[search] Jina failed, falling back:', (err as Error).message)
    }
  }
  return searchDuckDuckGo(query)
}

async function searchBrave(query: string): Promise<SearchResponse> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': process.env.BRAVE_API_KEY!,
    },
  })

  if (!res.ok) throw new Error(`Brave Search error: ${res.status}`)

  const data = (await res.json()) as any
  return {
    query,
    source: 'brave',
    timestamp: new Date().toISOString(),
    results: (data.web?.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    })),
  }
}

// Jina AI — requires JINA_API_KEY (free tier available at jina.ai)
async function searchJina(query: string): Promise<SearchResponse> {
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Return-Format': 'json',
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
    },
  })

  if (!res.ok) throw new Error(`Jina search error: ${res.status}`)

  const data = (await res.json()) as any
  const results: SearchResult[] = (data.data ?? []).slice(0, 10).map((r: any) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    description: r.description ?? r.content?.slice(0, 200) ?? '',
  }))

  return { query, source: 'jina', timestamp: new Date().toISOString(), results }
}

// DuckDuckGo HTML — free, no API key needed (the demo's out-of-the-box default)
async function searchDuckDuckGo(query: string): Promise<SearchResponse> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  })

  if (!res.ok) throw new Error(`DuckDuckGo search error: ${res.status}`)

  const html = await res.text()
  const results: SearchResult[] = []
  const blockRegex =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(html)) !== null && results.length < 10) {
    const rawUrl = match[1]
    const title = stripHtml(match[2])
    const description = stripHtml(match[3])

    // DuckDuckGo wraps URLs in a redirect: //duckduckgo.com/l/?uddg=<encoded>
    let finalUrl = rawUrl
    try {
      const parsed = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) finalUrl = decodeURIComponent(uddg)
    } catch {
      // leave as-is
    }

    if (title && finalUrl) {
      results.push({ title, url: finalUrl, description })
    }
  }

  return { query, source: 'duckduckgo', timestamp: new Date().toISOString(), results }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}