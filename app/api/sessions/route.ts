import { prisma } from "../../lib/db"

export async function POST() {
  try {
    const session = await prisma.session.create({
      data: { title: "New Chat" },
    })
    return Response.json(session)
  } catch (error) {
    console.error("Session create error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: "desc" },
    })
    return Response.json(sessions)
  } catch (error) {
    console.error("Session list error:", error)
    return Response.json({ error: String(error) }, { status: 500 })
  }
}