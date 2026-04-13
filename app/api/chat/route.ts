export const maxDuration = 30

import { NextRequest } from "next/server"
import { buildMemoryContext } from "../../lib/memory"
import { Tracer } from "../../lib/tracer"
import { getMemoryStore } from "../../lib/memory-store"
import { buildSummaryInjection, maybeCompress } from "../../lib/compressor"
import { makeSummarizerForProvider, OpenRouterSummarizer, GeminiSummarizer, OllamaSummarizer, ollamaOptions } from "../../lib/summarizer"
import { getSessionSnapshot } from "../../lib/snapshot"
import { getSkillInstructions, getPromotedSkillNames } from "../../lib/skills"
import { runApo } from "../../lib/apo"
import {
  scanForSycophancy, logScan,
  checkHardConstraints, logConstraints,
  getFilterMode, stripSycophancy,
  detectUserCorrection,
  detectMentalHealthCrisis,
  REWRITE_INJECTION,
  MENTAL_HEALTH_INJECTION_CRISIS,
  MENTAL_HEALTH_INJECTION_SOFT,
  type ScanResult,
  type ConstraintResult,
} from "../../lib/anti-sycophancy"
import { checkCorrectionPatterns } from "../../lib/skills"

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

    // Layer 5/6/8: Scan the incoming user message for corrections and mental health signals.
    const lastIncoming = [...messages].reverse().find((m: any) => m.role === "user")
    const incomingText = typeof lastIncoming?.content === 'string' ? lastIncoming.content : ""
    let mentalHealthInjection = ""
    if (incomingText.length > 0) {
      // Layer 5/6: correction detection
      const correction = detectUserCorrection(incomingText)
      if (correction.detected) {
        tracer.fire('user_correction', { severity: correction.severity })
        checkCorrectionPatterns(characterId).catch(console.error)
      }
      // Layer 8: mental health detection
      const mentalHealth = detectMentalHealthCrisis(incomingText)
      if (mentalHealth.triggered) {
        tracer.fire('mental_health_flag', { level: mentalHealth.level })
        mentalHealthInjection = mentalHealth.level === 'crisis'
          ? MENTAL_HEALTH_INJECTION_CRISIS
          : MENTAL_HEALTH_INJECTION_SOFT
      }
    }

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
          : OPENROUTER_API_KEY
            ? new OpenRouterSummarizer()
            : GEMINI_API_KEY
            ? new GeminiSummarizer()
            : new OllamaSummarizer()
        maybeCompress(sessionId, characterId, compressSummarizer).catch(console.error)
      }
    } catch {
      // Memory is best-effort
    }

    // Layer 8: append mental health injection after full prompt is assembled
    if (mentalHealthInjection) {
      fullPrompt += mentalHealthInjection
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
  const model = modelOverride || process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free"
  const mode = getFilterMode()
  const maxAttempts = mode === 'warn' ? 1 : 3

  let currentPrompt = systemPrompt
  let text = ""
  let scan: ScanResult = { flagged: false, detections: [], severity: 0, responseLength: 0 }
  let constraints: ConstraintResult = { passed: true, violations: [] }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const orMessages: any[] = [
      { role: "system", content: currentPrompt },
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
        frequency_penalty: 0.2,
        presence_penalty: 0.1,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("OpenRouter error:", response.status, errorText)
      tracer?.fire('llm_call', { provider: 'openrouter', model, messageCount: messages.length }, 'error', Date.now() - start)
      return new Response(`OpenRouter error: ${response.status}`, { status: 500 })
    }

    const data = await response.json()
    text = data.choices?.[0]?.message?.content || ""
    tracer?.fire('llm_call', { provider: 'openrouter', model, messageCount: messages.length, hasImage: !!image, attempt }, 'ok', Date.now() - start)

    scan = scanForSycophancy(text)
    constraints = checkHardConstraints(text)

    // In warn mode: log and ship. In rewrite/strip: retry if flagged and attempts remain.
    if (mode === 'warn' || (attempt >= maxAttempts) || (!scan.flagged && constraints.passed)) break

    // Amplify the prompt for the next attempt
    currentPrompt = systemPrompt + REWRITE_INJECTION
  }

  logScan(scan, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'openrouter', model })
  logConstraints(constraints, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'openrouter', model })

  // Layer 5: fire span for reward function
  if (scan.flagged) {
    tracer?.fire('sycophancy_detection', { severity: scan.severity, phrases: scan.detections.map(d => d.phrase), provider: 'openrouter', model })
  }

  const finalText = (mode === 'strip' && scan.flagged) ? stripSycophancy(text, scan) : text
  const ollamaFormat = JSON.stringify({ message: { content: finalText } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}

async function handleOllama(messages: {role: string, content: string}[], systemPrompt: string, image?: string, tracer?: Tracer, modelOverride?: string, characterId?: string) {
  const model = modelOverride || "gemma4:31b-cloud"
  const mode = getFilterMode()

  // Rewrite/strip mode: buffer the full response so we can scan and retry.
  // Warn mode: keep the streaming path so the user sees tokens as they arrive.
  if (mode !== 'warn') {
    return handleOllamaBuffered(messages, systemPrompt, image, tracer, model, characterId, mode)
  }

  // ── Warn mode: streaming path ─────────────────────────────────────────────
  const ollamaMessages = buildOllamaMessages(messages, systemPrompt, image)
  const start = Date.now()

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: ollamaMessages, stream: true, think: false, options: ollamaOptions() }),
  })

  tracer?.fire('llm_call', { provider: 'ollama', model, messageCount: messages.length, streaming: true }, 'ok', Date.now() - start)

  if (!response.body) {
    return new Response(response.body, { headers: { "Content-Type": "text/event-stream" } })
  }

  const sessionId = tracer?.sessionId
  let accumulated = ''
  const decoder = new TextDecoder()

  const scanningStream = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      try {
        const text = decoder.decode(chunk, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            const content = obj?.message?.content
            if (typeof content === 'string') accumulated += content
          } catch { /* partial line */ }
        }
      } catch { /* decoding failure should not interrupt the stream */ }
    },
    flush() {
      if (accumulated) {
        const scan = scanForSycophancy(accumulated)
        const constraints = checkHardConstraints(accumulated)
        logScan(scan, { characterId, sessionId: sessionId ?? undefined, provider: 'ollama', model })
        logConstraints(constraints, { characterId, sessionId: sessionId ?? undefined, provider: 'ollama', model })
        // Layer 5: fire span even in streaming/warn mode
        if (scan.flagged) {
          tracer?.fire('sycophancy_detection', { severity: scan.severity, phrases: scan.detections.map(d => d.phrase), provider: 'ollama', model })
        }
      }
    },
  })

  return new Response(response.body.pipeThrough(scanningStream), {
    headers: { "Content-Type": "text/event-stream" },
  })
}

/** Build Ollama message array (shared between streaming and buffered paths). */
function buildOllamaMessages(messages: {role: string, content: string}[], systemPrompt: string, image?: string) {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((m: any, i: number) => {
      if (image && i === messages.length - 1 && m.role === "user") {
        return { ...m, images: [image] }
      }
      return m
    }),
  ]
}

/** Buffered Ollama path for rewrite/strip mode. Non-streaming, scan-and-retry loop. */
async function handleOllamaBuffered(
  messages: {role: string, content: string}[],
  systemPrompt: string,
  image: string | undefined,
  tracer: Tracer | undefined,
  model: string,
  characterId: string | undefined,
  mode: 'rewrite' | 'strip',
) {
  const maxAttempts = 3
  let currentPrompt = systemPrompt
  let text = ""
  let scan: ScanResult = { flagged: false, detections: [], severity: 0, responseLength: 0 }
  let constraints: ConstraintResult = { passed: true, violations: [] }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ollamaMessages = buildOllamaMessages(messages, currentPrompt, image)
    const start = Date.now()

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: ollamaMessages, stream: false, think: false, options: ollamaOptions() }),
    })

    tracer?.fire('llm_call', { provider: 'ollama', model, messageCount: messages.length, streaming: false, attempt }, 'ok', Date.now() - start)

    if (!response.ok) {
      console.error("Ollama buffered error:", response.status)
      return new Response(`Ollama error: ${response.status}`, { status: 500 })
    }

    const data = await response.json()
    text = data.message?.content || ""

    scan = scanForSycophancy(text)
    constraints = checkHardConstraints(text)

    if ((attempt >= maxAttempts) || (!scan.flagged && constraints.passed)) break
    currentPrompt = systemPrompt + REWRITE_INJECTION
  }

  logScan(scan, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'ollama', model })
  logConstraints(constraints, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'ollama', model })

  // Layer 5: fire span for reward function
  if (scan.flagged) {
    tracer?.fire('sycophancy_detection', { severity: scan.severity, phrases: scan.detections.map(d => d.phrase), provider: 'ollama', model })
  }

  const finalText = (mode === 'strip' && scan.flagged) ? stripSycophancy(text, scan) : text
  const ollamaFormat = JSON.stringify({ message: { content: finalText } }) + "\n"
  return new Response(ollamaFormat, { headers: { "Content-Type": "text/event-stream" } })
}

async function handleGemini(messages: {role: string, content: string}[], systemPrompt: string, image?: string, tracer?: Tracer, modelOverride?: string, characterId?: string) {
  const model = modelOverride || "gemini-2.0-flash"
  const mode = getFilterMode()
  const maxAttempts = mode === 'warn' ? 1 : 3

  const contents = messages.map((m: any, i: number) => {
    const parts: any[] = [{ text: m.content }]
    if (image && i === messages.length - 1 && m.role === "user") {
      parts.push({ inline_data: { mime_type: "image/png", data: image } })
    }
    return { role: m.role === "assistant" ? "model" : "user", parts }
  })

  let currentPrompt = systemPrompt
  let text = ""
  let scan: ScanResult = { flagged: false, detections: [], severity: 0, responseLength: 0 }
  let constraints: ConstraintResult = { passed: true, violations: [] }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now()
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: currentPrompt }] },
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
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    tracer?.fire('llm_call', { provider: 'gemini', model, messageCount: messages.length, hasImage: !!image, attempt }, 'ok', Date.now() - start)

    scan = scanForSycophancy(text)
    constraints = checkHardConstraints(text)

    if (mode === 'warn' || (attempt >= maxAttempts) || (!scan.flagged && constraints.passed)) break
    currentPrompt = systemPrompt + REWRITE_INJECTION
  }

  logScan(scan, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'gemini', model })
  logConstraints(constraints, { characterId, sessionId: tracer?.sessionId ?? undefined, provider: 'gemini', model })

  // Layer 5: fire span for reward function
  if (scan.flagged) {
    tracer?.fire('sycophancy_detection', { severity: scan.severity, phrases: scan.detections.map(d => d.phrase), provider: 'gemini', model })
  }

  const finalText = (mode === 'strip' && scan.flagged) ? stripSycophancy(text, scan) : text
  const ollamaFormat = JSON.stringify({ message: { content: finalText } }) + "\n"
  return new Response(ollamaFormat, {
    headers: { "Content-Type": "text/event-stream" },
  })
}
