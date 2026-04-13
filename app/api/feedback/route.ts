import { NextRequest, NextResponse } from "next/server"
import { Tracer } from "../../lib/tracer"

export async function POST(req: NextRequest) {
  try {
    const { messageId, sessionId, feedbackType } = await req.json()

    if (!messageId || !sessionId || !feedbackType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const tracer = new Tracer(sessionId)
    tracer.fire("user_feedback", { messageId, feedbackType })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Feedback API error:", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
