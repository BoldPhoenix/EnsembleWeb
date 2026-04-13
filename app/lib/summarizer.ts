// Summarizer — single-method interface for all LLM-assisted text operations.
//
// Four consumers:
//   1. Context compressor (Phase 2) — summarize old messages into a block
//   2. APO mutator (Phase 5) — generate prompt variants
//   3. Skill auto-creator (Phase 4) — generate skill body from pattern
//   4. Reward scoring (future) — LLM-assisted quality assessment
//
// Each caller passes a different systemPrompt. The implementation just runs the
// LLM and returns the text. Callers own the prompt engineering.

export interface Summarizer {
  summarize(systemPrompt: string, input: string): Promise<string>
}

// ── OpenRouter implementation ─────────────────────────────────────────────────

export class OpenRouterSummarizer implements Summarizer {
  private readonly model: string

  constructor(model = 'google/gemma-3-4b-it:free') {
    this.model = model
  }

  async summarize(systemPrompt: string, input: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0.3,
        max_tokens: 512,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenRouter summarizer error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
}

// ── Ollama implementation ─────────────────────────────────────────────────────

export class OllamaSummarizer implements Summarizer {
  private readonly baseUrl: string
  private readonly model: string

  constructor(
    baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434',
    model = 'qwen2.5-coder:7b'
  ) {
    this.baseUrl = baseUrl
    this.model = model
  }

  async summarize(systemPrompt: string, input: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input },
        ],
        stream: false,
        think: false,
        options: ollamaOptions({ temperature: 0.3 }),
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama summarizer error: ${response.status}`)
    }

    const data = await response.json()
    return data.message?.content ?? ''
  }
}

// ── Gemini implementation ─────────────────────────────────────────────────────

export class GeminiSummarizer implements Summarizer {
  async summarize(systemPrompt: string, input: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: input }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini summarizer error: ${response.status}`)
    }

    const data = await response.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
}

// ── Shared Ollama options ─────────────────────────────────────────────────────
// Every Ollama inference call should include these options.
// num_gpu: 999  — force all layers to GPU; OOM cleanly rather than silently CPU-offloading.
// num_ctx:      — context window. Override via OLLAMA_NUM_CTX env var (default 8192).
//
// Usage: body: JSON.stringify({ ..., options: ollamaOptions() })
//        body: JSON.stringify({ ..., options: ollamaOptions({ temperature: 0.3 }) })

export function ollamaOptions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    num_gpu: 999,
    num_ctx: parseInt(process.env.OLLAMA_NUM_CTX ?? '8192', 10),
    ...extra,
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────
// Returns the best available Summarizer based on configured env vars.
// Priority matches the chat route: OpenRouter > Gemini > Ollama.

let _summarizer: Summarizer | null = null

export function getSummarizer(): Summarizer {
  if (_summarizer) return _summarizer

  if (process.env.OPENROUTER_API_KEY) {
    _summarizer = new OpenRouterSummarizer()
  } else if (process.env.GEMINI_API_KEY) {
    _summarizer = new GeminiSummarizer()
  } else {
    _summarizer = new OllamaSummarizer()
  }

  return _summarizer
}

// ── Per-character factory ─────────────────────────────────────────────────────
// Builds a Summarizer matching a character's configured provider.
// Used by the compressor so compression routes to the same backend as chat.

export function makeSummarizerForProvider(
  provider: string,
  llmModel?: string | null
): Summarizer {
  if (provider === 'gemini') return new GeminiSummarizer()
  if (provider === 'ollama') return new OllamaSummarizer(undefined, llmModel ?? undefined)
  // openrouter (default)
  return new OpenRouterSummarizer(llmModel ?? undefined)
}
