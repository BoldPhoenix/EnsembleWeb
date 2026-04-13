import { NextRequest } from "next/server"
import { getMemoryStore } from "../../../lib/memory-store"

// GET /api/skills/proposals?character=aimee — pending APO proposals for settings UI
export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get("character") || "aimee"
    await getMemoryStore().processExpiredProposals()
    const proposals = await getMemoryStore().getSkillProposals(characterId)
    return Response.json(proposals)
  } catch (error) {
    console.error("Proposals fetch error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
