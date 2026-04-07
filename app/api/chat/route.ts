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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Gemini error:", response.status, errorText)
      return new Response(`Gemini error: ${response.status}`, { status: 500 })
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""

    // Return as single chunk in Ollama format so ChatPanel still works
    const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
    return new Response(ollamaFormat, {
      headers: { "Content-Type": "text/event-stream" },
    })
  }