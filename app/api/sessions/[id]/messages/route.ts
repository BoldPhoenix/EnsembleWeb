import { prisma } from "../../../../lib/db"
  import { NextRequest } from "next/server"

  export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params
    const messages = await prisma.message.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
    })
    return Response.json(messages)
  }

  export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params
    const { role, content } = await req.json()
    const message = await prisma.message.create({
      data: { role, content, sessionId: id },
    })
    return Response.json(message)
  }