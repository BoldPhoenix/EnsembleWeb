import { getMemoryStore } from "../../lib/memory-store"

export async function POST() {
  try {
    const session = await getMemoryStore().createSession("New Chat")
    return Response.json(session)
  } catch (error) {
    console.error("Session create error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const sessions = await getMemoryStore().getRecentSessions(100)
    return Response.json(sessions)
  } catch (error) {
    console.error("Session list error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}