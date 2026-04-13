import { runApo } from "../../lib/apo"

// POST /api/apo — trigger APO beam search. Fire-and-forget from the chat route,
// or callable manually for testing.
export async function POST() {
  try {
    const proposalsCreated = await runApo()
    return Response.json({ proposalsCreated })
  } catch (error) {
    console.error("APO error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
