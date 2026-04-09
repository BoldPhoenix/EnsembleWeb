export const maxDuration = 30

import { NextRequest } from "next/server"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.86.126:11434"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

const DEFAULT_PROMPT = "You are a helpful assistant. Keep responses brief and conversational."

export async function POST(req: NextRequest) {
  const { messages, systemPrompt } = await req.json()
  const prompt = systemPrompt || DEFAULT_PROMPT

  if (GEMINI_API_KEY) {
    return handleGemini(messages, prompt)
  }
  return handleOllama(messages, prompt)
}

async function handleOllama(messages: {role: string, content: string}[], systemPrompt: string) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma4:31b-cloud",
      messages: [
        { role: "system", content: systemPrompt },
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

async function handleGemini(messages: {role: string, content: string}[], systemPrompt: string) {
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
          parts: [{ text: systemPrompt }],
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

  const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}
