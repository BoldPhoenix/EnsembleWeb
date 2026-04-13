import { getMemoryStore } from "../../../../lib/memory-store"
import { NextRequest } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const messages = await getMemoryStore().getSessionMessages(id)
  return Response.json(messages)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { role, content, personality } = await req.json()
  const message = await getMemoryStore().addMessage(id, role, content, personality || "aimee")
  return Response.json(message)
}