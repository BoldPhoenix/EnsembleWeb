import { NextRequest } from "next/server"

export async function POST(req: NextRequest) {
  const { tool, args } = await req.json()

  switch (tool) {
    case "web_search":
      return handleWebSearch(args.query)
    case "web_fetch":
      return handleWebFetch(args.url)
    case "youtube_transcript":
      return handleYouTubeTranscript(args.url)
    case "reddit_read":
      return handleRedditRead(args.url)
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

async function handleYouTubeTranscript(url: string) {
  if (!url) return Response.json({ result: "YouTube URL is required" })

  try {
    // Extract video ID from various YouTube URL formats
    const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]
    if (!videoId) return Response.json({ result: "Could not extract video ID from URL" })

    // Use youtube transcript API (invidious instance for transcript access)
    const instances = [
      `https://inv.nadeko.net/api/v1/videos/${videoId}`,
      `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
    ]

    for (const apiUrl of instances) {
      try {
        const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) })
        if (!response.ok) continue

        const data = await response.json()
        const title = data.title || "Unknown"
        const author = data.author || "Unknown"
        const description = data.description || ""
        const lengthSeconds = data.lengthSeconds || 0
        const minutes = Math.floor(lengthSeconds / 60)

        // Try to get captions
        let transcript = ""
        if (data.captions?.length > 0) {
          const captionUrl = data.captions[0].url
          try {
            const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) })
            if (captionRes.ok) {
              const captionText = await captionRes.text()
              // Strip XML tags from caption data
              transcript = captionText
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            }
          } catch {}
        }

        let result = `YouTube Video: ${title}\nBy: ${author}\nDuration: ${minutes} minutes\n\nDescription:\n${description}`
        if (transcript) {
          result += `\n\nTranscript:\n${transcript.slice(0, 15000)}`
        }

        return Response.json({ result })
      } catch {
        continue
      }
    }

    // Fallback to Jina Reader
    const jinaResponse = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "Accept": "text/markdown" },
      signal: AbortSignal.timeout(10000),
    })
    if (jinaResponse.ok) {
      const text = await jinaResponse.text()
      return Response.json({ result: text.slice(0, 15000) })
    }

    return Response.json({ result: "Could not access YouTube video transcript. Try providing the URL to web_fetch instead." })
  } catch (error) {
    return Response.json({ result: `YouTube transcript failed: ${error}` })
  }
}

async function handleRedditRead(url: string) {
  if (!url) return Response.json({ result: "Reddit URL is required" })

  try {
    // Reddit has a JSON API — just append .json to any URL
    const jsonUrl = url.replace(/\/$/, "") + ".json"
    const response = await fetch(jsonUrl, {
      headers: {
        "User-Agent": "TinManWeb/1.0",
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return Response.json({ result: `Reddit returned ${response.status}. The post may be private or the URL invalid.` })
    }

    const data = await response.json()

    // Parse post data
    const post = data[0]?.data?.children?.[0]?.data
    if (!post) return Response.json({ result: "Could not parse Reddit post data" })

    let result = `Reddit Post: ${post.title || "Unknown"}\n`
    result += `By: u/${post.author || "Unknown"} in r/${post.subreddit || "Unknown"}\n`
    result += `Score: ${post.score || 0} | Comments: ${post.num_comments || 0}\n\n`

    if (post.selftext) {
      result += `Post:\n${post.selftext.slice(0, 5000)}\n\n`
    }
    if (post.url && post.url !== post.permalink) {
      result += `Link: ${post.url}\n\n`
    }

    // Parse top comments
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
