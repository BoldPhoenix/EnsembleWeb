import { NextRequest } from "next/server"

  export async function POST(req: NextRequest) {
    const { messages } = await req.json()

    const response = await fetch("http://192.168.86.126:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:31b-cloud",
        messages: messages,
        stream: true,
        think: false,
      }),
    })

    return new Response(response.body, {
      headers: { "Content-Type": "text/event-stream" },
    })
  }