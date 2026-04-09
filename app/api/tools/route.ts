import { NextRequest } from "next/server"

export async function POST(req: NextRequest) {
  const { tool, args } = await req.json()

  switch (tool) {
    case "web_search":
      return handleWebSearch(args.query)
    case "web_fetch":
      return handleWebFetch(args.url)
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 })
  }
}

async function handleWebSearch(query: string) {
  if (!query) return Response.json({ result: "Search query is required" })

  try {
    // Use DuckDuckGo HTML search (no API key needed, privacy-friendly)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    })

    const html = await response.text()

    // Extract search results from DDG HTML
    const results: string[] = []
    const resultPattern = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    const snippetPattern = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g

    let match
    const links: string[] = []
    const titles: string[] = []

    while ((match = resultPattern.exec(html)) !== null) {
      links.push(decodeURIComponent(match[1].replace(/\/l\/\?uddg=/, "").split("&")[0]))
      titles.push(match[2].trim())
    }

    const snippets: string[] = []
    while ((match = snippetPattern.exec(html)) !== null) {
      snippets.push(match[1].trim())
    }

    for (let i = 0; i < Math.min(links.length, 5); i++) {
      results.push(`${i + 1}. ${titles[i] || ""}`)
      if (snippets[i]) results.push(`   ${snippets[i]}`)
      results.push(`   ${links[i]}`)
      results.push("")
    }

    return Response.json({
      result: results.length > 0
        ? `Search results for "${query}":\n\n${results.join("\n")}`
        : `No results found for "${query}".`,
    })
  } catch (error) {
    return Response.json({ result: `Search failed: ${error}` })
  }
}

async function handleWebFetch(url: string) {
  if (!url) return Response.json({ result: "URL is required" })

  // Try Jina Reader first — converts any page to clean markdown
  try {
    const jinaResponse = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "Accept": "text/markdown",
      },
    })

    if (jinaResponse.ok) {
      let text = await jinaResponse.text()
      if (text.length > 30000) {
        text = text.slice(0, 30000) + "\n\n[... content truncated at 30KB]"
      }
      return Response.json({
        result: `Content from ${url}:\n\n${text}`,
      })
    }
  } catch {
    // Jina failed, fall back to raw fetch
  }

  // Fallback: raw HTML fetch with tag stripping
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    })

    const html = await response.text()

    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim()

    if (text.length > 30000) {
      text = text.slice(0, 30000) + "\n\n[... content truncated at 30KB]"
    }

    return Response.json({
      result: `Content from ${url}:\n\n${text}`,
    })
  } catch (error) {
    return Response.json({ result: `Failed to fetch ${url}: ${error}` })
  }
}
