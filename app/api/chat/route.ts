export const maxDuration = 30

import { NextRequest } from "next/server"
import { buildMemoryContext } from "../../lib/memory"
import { Tracer } from "../../lib/tracer"
import { getMemoryStore } from "../../lib/memory-store"
import { buildSummaryInjection, maybeCompress } from "../../lib/compressor"
import { makeSummarizerForProvider, getSummarizer, ollamaOptions } from "../../lib/summarizer"
import { getSessionSnapshot } from "../../lib/snapshot"
import { getSkillInstructions, getPromotedSkillNames } from "../../lib/skills"
import { runApo } from "../../lib/apo"
import { scanForSycophancy, logScan } from "../../lib/anti-sycophancy"

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

const DEFAULT_PROMPT = "You are a helpful assistant. Keep responses brief and conversational."

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt, image, sessionId, personality } = await req.json()
    const basePrompt = systemPrompt || DEFAULT_PROMPT
    const characterId = personality || 'aimee'
    const tracer = new Tracer(sessionId)

    // Look up CharacterConfig for character-specific provider/model override.
    // CharacterConfig rows are optional — if none exists, fall through to global env var chain.
    const characterConfig = await getMemoryStore().getCharacterConfig(characterId).catch(() => null)

    // Process any stale sessions that never got scored, then run APO (fire-and-forget)
    if (sessionId) {
      getMemoryStore().processStaleSessionFires(86_400_000)
        .then(() => runApo())
        .catch(console.error)
    }

    // Build full prompt: base + compression summaries + memory context
    let fullPrompt = basePrompt
    try {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")
      const userText = lastUserMsg?.content || ""

      // snapshot = frozen long-term topics at session start (cached in-process)
      // memoryContext = live keyword lookup for current message + session list
      // summaryInjection = compressed summaries of older turns
      const [snapshot, memoryContext, summaryInjection] = await tracer.span(
        'memory_read',
        { query: userText.slice(0, 100), hasSession: !!sessionId },
        () => Promise.all([
          sessionId ? getSessionSnapshot(sessionId, characterId) : Promise.resolve(''),
          buildMemoryContext(userText, characterId),
          sessionId ? buildSummaryInjection(sessionId, characterId) : Promise.resolve(''),
        ])
      )

      // Skill instructions — promoted skills for this character
      const skillInstructions = await getSkillInstructions(characterId)

      // Context injection order (see plan):
      // [base prompt] + [skill instructions] + [snapshot topics] + [compression summaries] + [live memory]
      const parts = [basePrompt]
      if (skillInstructions) parts.push(skillInstructions)
      if (snapshot) parts.push(snapshot)
      if (summaryInjection) parts.push(summaryInjection)
      if (memoryContext) parts.push(memoryContext)
      fullPrompt = parts.join('\n\n')

      // Record skill_fire spans for each promoted skill injected
      if (sessionId && skillInstructions) {
        const firedSkills = await getPromotedSkillNames(characterId)
        for (const skillName of firedSkills) {
          tracer.fire('skill_fire', { skillName, characterId })
        }
      }

      // Trigger compression for older messages (fire-and-forget).
      // Use the character's configured provider so compression and chat use the same backend.
      if (sessionId) {
        const compressSummarizer = characterConfig
          ? makeSummarizerForProvider(characterConfig.provider, characterConfig.llmModel)
          : getSummarizer()
        maybeCompress(sessionId, characterId, compressSummarizer).catch(console.error)
      }
    } catch {
      // Memory is best-effort
    }

    // Character-specific dispatch: CharacterConfig.provider takes precedence over global env var chain.
    // Falls back to global chain (OpenRouter > Gemini > Ollama) when no CharacterConfig row exists.
    if (characterConfig) {
      if (characterConfig.provider === 'openrouter' && OPENROUTER_API_KEY) {
        return handleOpenRouter(messages, fullPrompt, image, tracer, characterConfig.llmModel ?? undefined, characterId)
      }
      if (characterConfig.provider === 'gemini' && GEMINI_API_KEY) {
        return handleGemini(messages, fullPrompt, image, tracer, characterConfig.llmModel ?? undefined, characterId)
      }
      if (characterConfig.provider === 'ollama') {
        return handleOllama(messages, fullPrompt, image, tracer, characterConfig.llmModel ?? undefined, characterId)
      }
      // CharacterConfig exists but the required API key is missing — log and fall through
      console.warn(`CharacterConfig for '${characterId}' specifies provider '${characterConfig.provider}' but the required API key/URL is not configured. Falling back to global chain.`)
    }

    // Global fallback chain: OpenRouter > Gemini > Ollama
    if (OPENROUTER_API_KEY) {
      return handleOpenRouter(messages, fullPrompt, image, tracer, undefined, characterId)
    }
    if (GEMINI_API_KEY) {
      return handleGemini(messages, fullPrompt, image, tracer, undefined, characterId)
    }
    return handleOllama(messages, fullPrompt, image, tracer, undefined, characterId)
  } catch (error) {
    console.error("Chat API error:", error)
    return new Response(`Chat error: ${String(error)}`, { status: 500 })
  }
}

async function handleOpenRouter(messages: {role: string, content: string}[], systemPrompt: string, image?: string, tracer?: Tracer, modelOverride?: string, characterId?: string) {
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

  const model = modelOverride || process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free"
  const start = Date.now()

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: orMessages,
      temperature: 0.7,
      frequency_penalty: 0.2,  // mild — too high causes prompt leakage
      presence_penalty: 0.1,
      max_tokens: 2048,        // generous for code blocks; loop control via penalties
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("OpenRouter error:", response.status, errorText)
    tracer?.fire('llm_call', { provider: 'openrouter', model, messageCount: messages.length }, 'error', Date.now() - start)
    return new Response(`OpenRouter error: ${response.status}`, { status: 500 })
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ""

  tracer?.fire('llm_call', { provider: 'openrouter', model, messageCount: messages.length, hasImage: !!image }, 'ok', Date.now() - start)

  // Anti-sycophancy scan (Layer 3, warn mode). Logs detections to stdout for
  // baseline measurement without blocking or modifying the response.
  const scan = scanForSycophancy(text)
  logScan(scan, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'openrouter', model })

  const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}

async function handleOllama(messages: {role: string, content: string}[], systemPrompt: string, image?: string, tracer?: Tracer, modelOverride?: string, characterId?: string) {
  const ollamaMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m: any, i: number) => {
      if (image && i === messages.length - 1 && m.role === "user") {
        return { ...m, images: [image] }
      }
      return m
    }),
  ]

  const model = modelOverride || "gemma4:31b-cloud"
  const start = Date.now()

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: ollamaMessages,
      stream: true,
      think: false,
      options: ollamaOptions(),
    }),
  })

  // Streaming: span fires at time-to-first-byte (can't time full generation)
  tracer?.fire('llm_call', { provider: 'ollama', model, messageCount: messages.length, streaming: true }, 'ok', Date.now() - start)

  // Anti-sycophancy scan on streaming responses: tee the stream through a
  // TransformStream that accumulates content for post-stream scanning, without
  // modifying what the user sees. Scan fires once the stream completes.
  if (!response.body) {
    return new Response(response.body, {
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const sessionId = tracer?.sessionId
  let accumulated = ''
  const decoder = new TextDecoder()

  const scanningStream = new TransformStream({
    transform(chunk, controller) {
      // Pass-through to the user unchanged
      controller.enqueue(chunk)
      // Accumulate for scanning. Ollama emits JSON-lines with message.content fields.
      try {
        const text = decoder.decode(chunk, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            const content = obj?.message?.content
            if (typeof content === 'string') accumulated += content
          } catch {
            // partial line — ignore, next chunk will complete it
          }
        }
      } catch {
        // decoding failure should not interrupt the stream
      }
    },
    flush() {
      if (accumulated) {
        const scan = scanForSycophancy(accumulated)
        logScan(scan, { characterId, sessionId: sessionId ?? undefined, provider: 'ollama', model })
      }
    },
  })

  return new Response(response.body.pipeThrough(scanningStream), {
    headers: { "Content-Type": "text/event-stream" },
  })
}

async function handleGemini(messages: {role: string, content: string}[], systemPrompt: string, image?: string, tracer?: Tracer, modelOverride?: string, characterId?: string) {
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

  const model = modelOverride || "gemini-2.0-flash"
  const start = Date.now()

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
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
    tracer?.fire('llm_call', { provider: 'gemini', model, messageCount: messages.length }, 'error', Date.now() - start)
    return new Response(`Gemini error: ${response.status}`, { status: 500 })
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""

  tracer?.fire('llm_call', { provider: 'gemini', model, messageCount: messages.length, hasImage: !!image }, 'ok', Date.now() - start)

  // Anti-sycophancy scan (Layer 3, warn mode).
  const scan = scanForSycophancy(text)
  logScan(scan, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'gemini', model })

  const ollamaFormat = JSON.stringify({ message: { content: text } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}
