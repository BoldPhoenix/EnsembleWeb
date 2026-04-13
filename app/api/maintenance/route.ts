import { NextRequest } from "next/server"
import { getMemoryStore } from "../../lib/memory-store"
import type { EvictionOptions } from "../../lib/types"

// GET /api/maintenance — current storage stats (row counts per table)
export async function GET() {
  try {
    const stats = await getMemoryStore().getStorageStats()
    return Response.json(stats)
  } catch (error) {
    console.error("Maintenance stats error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

// POST /api/maintenance — run eviction with optional overrides
// Body (all optional):
//   maxSpanAgeDays:    number  (default 30)
//   maxSessionCount:   number  (default 100)
//   maxSummaryAgeDays: number  (default 90)
export async function POST(req: NextRequest) {
  try {
    const body: EvictionOptions = await req.json().catch(() => ({}))
    const result = await getMemoryStore().runEviction(body)
    return Response.json(result)
  } catch (error) {
    console.error("Maintenance eviction error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
