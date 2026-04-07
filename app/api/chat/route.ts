export const maxDuration = 30

import { NextRequest } from "next/server"

  const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.86.126:11434"
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY

  export async function POST(req: NextRequest) {
    const { messages } = await req.json()

    if (GEMINI_API_KEY) {
      return handleGemini(messages)
    }
    return handleOllama(messages)
  }

  async function handleOllama(messages: {role: string, content: string}[]) {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:31b-cloud",
        messages: [
          { role: "system", content: "You are a helpful assistant. Keep responses brief and conversational." },
          ...messages
        ],
        stream: true,
        think: false,
      }),
    })

    return new Response(response.body, {
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  async function handleGemini(messages: {role: string, content: string}[]) {
    const lastMessage = messages[messages.length - 1].content

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          systemInstruction: {
            parts: [{ text: "You are a helpful assistant. Keep responses brief and conversational." }],
          },
        }),
      }
    )

    const reader = response.body?.getReader()
    if (!reader) return new Response("No response", { status: 500 })

    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const data = JSON.parse(line.slice(6))
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text
              if (text) {
                const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
                controller.enqueue(new TextEncoder().encode(ollamaFormat))
              }
            } catch {
              // skip
            }
          }
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    })
  }