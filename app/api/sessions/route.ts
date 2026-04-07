import { prisma } from "../../lib/db"
  import { NextRequest } from "next/server"

  export async function POST() {
    const session = await prisma.session.create({
      data: { title: "New Chat" },
    })
    return Response.json(session)
  }

  export async function GET() {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: "desc" },
    })
    return Response.json(sessions)
  }