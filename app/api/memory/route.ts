import { NextRequest } from "next/server"
import { extractAndStoreTopics, buildMemoryContext } from "../../lib/memory"

// POST — extract topics from a conversation turn
export async function POST(req: NextRequest) {
  try {
    const { userMessage, assistantMessage, messageId, personality } = await req.json()
    await extractAndStoreTopics(userMessage, assistantMessage, messageId, personality ?? null)
    return Response.json({ ok: true })
  } catch (error) {
    console.error("Memory extraction error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

// GET — build memory context for a user message
export async function GET(req: NextRequest) {
  try {
    const userMessage = req.nextUrl.searchParams.get("q") || ""
    const characterId = req.nextUrl.searchParams.get("character") || undefined
    const context = await buildMemoryContext(userMessage, characterId)
    return Response.json({ context })
  } catch (error) {
    console.error("Memory recall error:", error)
    return Response.json({ context: "" })
  }
}
