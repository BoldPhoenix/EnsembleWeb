// Tracer — lightweight span collector for the intelligence layer.
//
// Usage:
//   const tracer = new Tracer(sessionId)
//   const result = await tracer.span('llm_call', { provider: 'openrouter' }, () => callLLM())
//   tracer.fire('memory_read', { topicCount: 5 })  // fire-and-forget (no wrapping needed)
//
// All recordSpan calls are fire-and-forget — span failures never block the chat response.
// If sessionId is not provided, spans are silently discarded.

import { randomUUID } from 'crypto'
import { getMemoryStore } from './memory-store'
import type { SpanKind } from './types'

export class Tracer {
  readonly traceId: string
  readonly sessionId: string | null

  constructor(sessionId: string | null | undefined) {
    this.sessionId = sessionId ?? null
    this.traceId = randomUUID()
  }

  // Wrap an async operation in a span. Records duration and ok/error status.
  async span<T>(
    kind: SpanKind,
    metadata: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.sessionId) return fn()

    const start = Date.now()
    try {
      const result = await fn()
      getMemoryStore().recordSpan({
        sessionId: this.sessionId,
        traceId: this.traceId,
        kind,
        status: 'ok',
        durationMs: Date.now() - start,
        metadata,
      }).catch(console.error)
      return result
    } catch (e) {
      getMemoryStore().recordSpan({
        sessionId: this.sessionId,
        traceId: this.traceId,
        kind,
        status: 'error',
        durationMs: Date.now() - start,
        metadata: { ...metadata, error: String(e) },
      }).catch(console.error)
      throw e
    }
  }

  // Record a span without wrapping an operation — for streaming or already-elapsed events.
  fire(
    kind: SpanKind,
    metadata: Record<string, unknown>,
    status: 'ok' | 'error' = 'ok',
    durationMs?: number
  ): void {
    if (!this.sessionId) return
    getMemoryStore().recordSpan({
      sessionId: this.sessionId,
      traceId: this.traceId,
      kind,
      status,
      durationMs,
      metadata,
    }).catch(console.error)
  }
}
