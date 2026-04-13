import { NextRequest, NextResponse } from "next/server"
import { getMemoryStore } from "../../lib/memory-store"

/**
 * GET /api/honesty?character=aimee
 *
 * Returns anti-sycophancy stats for the settings "How [Name] Pushes Back" tab.
 * Aggregates sycophancy_detection, user_correction, and mental_health_flag spans
 * from the 20 most recent sessions.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const characterId = searchParams.get("character") || "aimee"

  try {
    const store = getMemoryStore()
    const sessions = await store.getRecentSessions(20)

    let detectionCount = 0
    let correctionCount = 0
    let mentalHealthCount = 0
    let feedbackCount = 0
    const phraseCounts: Record<string, number> = {}

    for (const session of sessions) {
      const spans = await store.querySpans(session.id)
      for (const span of spans) {
        if (span.kind === "sycophancy_detection") {
          detectionCount++
          const phrases = (span.metadata as Record<string, unknown> | null)?.phrases as string[] | undefined
          if (Array.isArray(phrases)) {
            for (const p of phrases) {
              phraseCounts[p] = (phraseCounts[p] ?? 0) + 1
            }
          }
        }
        if (span.kind === "user_correction") correctionCount++
        if (span.kind === "mental_health_flag") mentalHealthCount++
        if (span.kind === "user_feedback") feedbackCount++
      }
    }

    const topPhrases = Object.entries(phraseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase, count]) => ({ phrase, count }))

    // Check for the auto-generated anti-sycophancy correction skill
    const stats = await store.getSkillStats(characterId)
    const asCorrectionSkill = stats.find(s => s.skillName === "anti_sycophancy_correction") ?? null

    return NextResponse.json({
      sessionCount: sessions.length,
      detectionCount,
      correctionCount,
      mentalHealthCount,
      feedbackCount,
      topPhrases,
      correctionSkill: asCorrectionSkill
        ? {
            promoted: asCorrectionSkill.promoted,
            score: Math.round(asCorrectionSkill.score * 100),
            trials: asCorrectionSkill.trials,
          }
        : null,
    })
  } catch (e) {
    console.error("Honesty API error:", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
