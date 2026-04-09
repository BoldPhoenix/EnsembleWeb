export const maxDuration = 30

import { NextRequest } from "next/server"
import { buildMemoryContext } from "../../lib/memory"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://192.168.86.126:11434"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

const DEFAULT_PROMPT = "You are a helpful assistant. Keep responses brief and conversational."

export async function POST(req: NextRequest) {
  const { messages, systemPrompt, image } = await req.json()
  const basePrompt = systemPrompt || DEFAULT_PROMPT

  // Build memory context from the latest user message
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")
  let memoryContext = ""
  try {
    memoryContext = await buildMemoryContext(lastUserMsg?.content || "")
  } catch {
    // Memory is best-effort
  }

  const fullPrompt = memoryContext
    ? `${basePrompt}\n\n${memoryContext}`
    : basePrompt

  // Priority: OpenRouter > Gemini > Ollama
  if (OPENROUTER_API_KEY) {
    return handleOpenRouter(messages, fullPrompt, image)
  }
  if (GEMINI_API_KEY) {
    return handleGemini(messages, fullPrompt, image)
  }
  return handleOllama(messages, fullPrompt, image)
}

async function handleOpenRouter(messages: {role: string, content: string}[], systemPrompt: string, image?: string) {
  const orMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: any, i: number) => {
      if (image && i === messages.length - 1 && m.role === "user") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
          ],
        }
      }
      return m
    }),
  ]

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
      messages: orMessages,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("OpenRouter error:", response.status, errorText)
    return new Response(`OpenRouter error: ${response.status}`, { status: 500 })
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ""

  const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}

async function handleOllama(messages: {role: string, content: string}[], systemPrompt: string, image?: string) {
  const ollamaMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: any, i: number) => {
      if (image && i === messages.length - 1 && m.role === "user") {
        return { ...m, images: [image] }
      }
      return m
    }),
  ]

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemma4:31b-cloud",
      messages: ollamaMessages,
      stream: true,
      think: false,
    }),
  })

  return new Response(response.body, {
    headers: { "Content-Type": "text/event-stream" },
  })
}

async function handleGemini(messages: {role: string, content: string}[], systemPrompt: string, image?: string) {
  const contents = messages.map((m: any, i: number) => {
    const parts: any[] = [{ text: m.content }]
    if (image && i === messages.length - 1 && m.role === "user") {
      parts.push({
        inline_data: { mime_type: "image/png", data: image },
      })
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    }
  })

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
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
