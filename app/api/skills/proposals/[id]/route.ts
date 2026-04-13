import { NextRequest } from "next/server"
import { getMemoryStore } from "../../../../lib/memory-store"

// POST /api/skills/proposals/[id] — accept or reject a proposal
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { accepted } = await req.json()
    if (typeof accepted !== "boolean") {
      return Response.json({ error: "accepted must be boolean" }, { status: 400 })
    }
    await getMemoryStore().resolveSkillProposal(id, accepted)
    return Response.json({ ok: true })
  } catch (error) {
    console.error("Proposal resolve error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
