import { NextResponse } from "next/server"

// GET /api/ollama/models — proxies Ollama's /api/tags and returns model names.
// Keeps OLLAMA_URL server-side; frontend never sees the raw host.

export async function GET() {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434"

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return NextResponse.json({ models: [] }, { status: 200 })
    }

    const data = await res.json()
    const models: string[] = (data.models ?? []).map((m: { name: string }) => m.name)
    return NextResponse.json({ models })
  } catch {
    // Ollama unreachable — return empty list, not an error
    return NextResponse.json({ models: [] })
  }
}
