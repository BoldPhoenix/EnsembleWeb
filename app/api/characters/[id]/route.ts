import { NextRequest, NextResponse } from "next/server"
import { getMemoryStore } from "../../../lib/memory-store"
import { personalities } from "../../../lib/personalities"

const VALID_PROVIDERS = ["openrouter", "gemini", "ollama"] as const

// GET /api/characters/[id] — returns current provider/model config, or defaults
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!personalities[id]) {
    return NextResponse.json({ error: "Unknown character" }, { status: 404 })
  }
  const config = await getMemoryStore().getCharacterConfig(id).catch(() => null)
  return NextResponse.json({
    provider: config?.provider ?? "openrouter",
    llmModel: config?.llmModel ?? "",
  })
}

// PUT /api/characters/[id] — upsert provider/model override
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!personalities[id]) {
    return NextResponse.json({ error: "Unknown character" }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const provider: string = body?.provider ?? "openrouter"
  const llmModel: string | null = body?.llmModel?.trim() || null

  if (!VALID_PROVIDERS.includes(provider as typeof VALID_PROVIDERS[number])) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 })
  }

  await getMemoryStore().upsertCharacterConfig(id, provider, llmModel)
  return NextResponse.json({ ok: true })
}
