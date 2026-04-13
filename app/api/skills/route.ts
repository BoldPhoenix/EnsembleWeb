import { NextRequest } from "next/server"
import { getMemoryStore } from "../../lib/memory-store"
import { ensureCharacterSkills } from "../../lib/skills"

// GET /api/skills?character=aimee — list skill stats for settings UI
export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get("character") || "aimee"
    await ensureCharacterSkills(characterId)
    const stats = await getMemoryStore().getSkillStats(characterId)
    return Response.json(stats)
  } catch (error) {
    console.error("Skills fetch error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

// DELETE /api/skills?name=X&character=Y — prune a skill
export async function DELETE(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name")
    if (!name) return Response.json({ error: "name required" }, { status: 400 })
    await getMemoryStore().pruneSkill(name)
    return Response.json({ ok: true })
  } catch (error) {
    console.error("Skill delete error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

// POST /api/skills/reset?character=Y — reset learned behaviors
export async function POST(req: NextRequest) {
  try {
    const { action, characterId } = await req.json()
    const store = getMemoryStore()

    if (action === "reset_behaviors") {
      await store.resetLearnedBehaviors()
      return Response.json({ ok: true })
    }
    if (action === "reset_memory" && characterId) {
      await store.resetCharacterMemory(characterId)
      // Invalidate the snapshot cache so the next session rebuilds from DB
      const { invalidateAllSnapshots } = await import("../../lib/snapshot")
      invalidateAllSnapshots()
      return Response.json({ ok: true })
    }
    if (action === "factory_reset") {
      await store.factoryReset()
      const { invalidateAllSnapshots } = await import("../../lib/snapshot")
      invalidateAllSnapshots()
      return Response.json({ ok: true })
    }

    return Response.json({ error: "unknown action" }, { status: 400 })
  } catch (error) {
    console.error("Skills action error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
