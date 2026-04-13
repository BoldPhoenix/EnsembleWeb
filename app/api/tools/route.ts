import { NextRequest } from "next/server"
import { chromium } from "playwright-core"
import { Tracer } from "../../lib/tracer"

// Helper to fetch with a strict timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

// Lightpanda cloud headless browser for JS-rendered page fetching.
// Falls back to Jina Reader if not configured or if Lightpanda fails.
// 9× faster than Chrome headless, 16× less memory, designed for AI agents.
async function fetchViaLightpanda(url: string, timeoutMs = 15000): Promise<string | null> {
  const token = process.env.LIGHTPANDA_TOKEN
  if (!token) return null

  const region = process.env.LIGHTPANDA_REGION || "uswest"
  const endpoint = `wss://${region}.cloud.lightpanda.io/ws?token=${token}`

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
  try {
    // Connect to remote Lightpanda over CDP via WebSocket
    browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs })
    const context = browser.contexts()[0] || (await browser.newContext())
    const page = await context.newPage()

    // Navigate with timeout — load event fires when JS is done executing
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs })

    // Pull the rendered text content of the body
    const text = await page.evaluate(() => {
      const body = document.body
      if (!body) return ""
      // Strip script/style tags before grabbing text so we don't include code
      const clone = body.cloneNode(true) as HTMLElement
      clone.querySelectorAll("script, style, noscript").forEach(el => el.remove())
      return clone.innerText || clone.textContent || ""
    })

    await page.close()
    return text.trim()
  } catch (err) {
    console.error("Lightpanda fetch failed:", err)
    return null
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

export async function POST(req: NextRequest) {
  const { tool, args, sessionId } = await req.json()
  const tracer = new Tracer(sessionId)

  const start = Date.now()
  let response: Response

  switch (tool) {
    case "web_search":
      response = await handleWebSearch(args.query)
      break
    case "web_fetch":
      response = await handleWebFetch(args.url)
      break
    case "youtube_transcript":
      response = await handleYouTubeTranscript(args.url)
      break
    case "reddit_read":
      response = await handleRedditRead(args.url)
      break
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 })
  }

  tracer.fire('tool_use', { tool, success: response.ok }, response.ok ? 'ok' : 'error', Date.now() - start)
  return response
}

async function handleWebSearch(query: string) {
  if (!query) return Response.json({ result: "Search query is required" })

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    })

    const html = await response.text()

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

  // Provider chain: Lightpanda (if configured) → Jina Reader → raw HTML.
  // Lightpanda handles JS-rendered pages cleanly. Jina is fast for static
  // content. Raw HTML is the always-works last resort.

  // 1. Try Lightpanda first if token is configured
  const lightpandaText = await fetchViaLightpanda(url)
  if (lightpandaText && lightpandaText.length > 100) {
    let text = lightpandaText
    if (text.length > 30000) {
      text = text.slice(0, 30000) + "\n\n[... content truncated at 30KB]"
    }
    return Response.json({ result: `Content from ${url}:\n\n${text}` })
  }

  // 2. Try Jina Reader (fast and clean for static pages)
  try {
    const jinaResponse = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/markdown" },
    })

    if (jinaResponse.ok) {
      let text = await jinaResponse.text()
      if (text.length > 30000) {
        text = text.slice(0, 30000) + "\n\n[... content truncated at 30KB]"
      }
      return Response.json({ result: `Content from ${url}:\n\n${text}` })
    }
  } catch {
    // Jina failed, fall back
  }

  // 3. Last resort: raw HTML fetch with crude tag stripping
  try {
    const response = await fetchWithTimeout(url, {
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
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim()

    if (text.length > 30000) {
      text = text.slice(0, 30000) + "\n\n[... content truncated at 30KB]"
    }

    return Response.json({ result: `Content from ${url}:\n\n${text}` })
  } catch (error) {
    return Response.json({ result: `Failed to fetch ${url}: ${error}` })
  }
}

async function handleYouTubeTranscript(url: string) {
  if (!url) return Response.json({ result: "YouTube URL is required" })

  try {
    const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]
    if (!videoId) return Response.json({ result: "Could not extract video ID from URL" })

    // Single Invidious instance with strict timeout
    try {
      const response = await fetchWithTimeout(
        `https://inv.nadeko.net/api/v1/videos/${videoId}`,
        {},
        8000
      )

      if (response.ok) {
        const data = await response.json()
        const title = data.title || "Unknown"
        const author = data.author || "Unknown"
        const description = data.description || ""
        const minutes = Math.floor((data.lengthSeconds || 0) / 60)

        let transcript = ""
        if (data.captions?.length > 0) {
          try {
            const captionRes = await fetchWithTimeout(data.captions[0].url, {}, 5000)
            if (captionRes.ok) {
              const captionText = await captionRes.text()
              transcript = captionText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            }
          } catch {}
        }

        let result = `YouTube Video: ${title}\nBy: ${author}\nDuration: ${minutes} minutes\n\nDescription:\n${description}`
        if (transcript) {
          result += `\n\nTranscript:\n${transcript.slice(0, 15000)}`
        }
        return Response.json({ result })
      }
    } catch {}

    // Fallback: just fetch the page via Jina
    try {
      const jinaRes = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
        headers: { "Accept": "text/markdown" },
      })
      if (jinaRes.ok) {
        return Response.json({ result: (await jinaRes.text()).slice(0, 15000) })
      }
    } catch {}

    return Response.json({ result: "Could not access YouTube video. Try web_fetch instead." })
  } catch (error) {
    return Response.json({ result: `YouTube transcript failed: ${error}` })
  }
}

async function handleRedditRead(url: string) {
  if (!url) return Response.json({ result: "Reddit URL is required" })

  try {
    const jsonUrl = url.replace(/\/$/, "") + ".json"
    const response = await fetchWithTimeout(jsonUrl, {
      headers: { "User-Agent": "EnsembleWeb/1.0" },
    })

    if (!response.ok) {
      return Response.json({ result: `Reddit returned ${response.status}. The post may be private or the URL invalid.` })
    }

    const data = await response.json()
    const post = data[0]?.data?.children?.[0]?.data
    if (!post) return Response.json({ result: "Could not parse Reddit post data" })

    let result = `Reddit Post: ${post.title || "Unknown"}\n`
    result += `By: u/${post.author || "Unknown"} in r/${post.subreddit || "Unknown"}\n`
    result += `Score: ${post.score || 0} | Comments: ${post.num_comments || 0}\n\n`

    if (post.selftext) {
      result += `Post:\n${post.selftext.slice(0, 5000)}\n\n`
    }
    if (post.url && !post.url.includes(post.permalink)) {
      result += `Link: ${post.url}\n\n`
    }

    const comments = data[1]?.data?.children || []
    if (comments.length > 0) {
      result += "Top Comments:\n"
      for (const comment of comments.slice(0, 10)) {
        const c = comment.data
        if (!c?.body) continue
        result += `\n[u/${c.author} | ${c.score} pts]:\n${c.body.slice(0, 500)}\n`
      }
    }

    if (result.length > 15000) {
      result = result.slice(0, 15000) + "\n\n[... truncated]"
    }

    return Response.json({ result })
  } catch (error) {
    return Response.json({ result: `Reddit read failed: ${error}` })
  }
}
