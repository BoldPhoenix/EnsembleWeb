// Compressor — context compression for long sessions.
//
// Design:
//   The frontend sends the last 20 messages on every request.
//   This module manages a server-side summary layer for everything older.
//
//   Trigger: when DB message count > RAW_WINDOW_SIZE and there are unsummarized
//   messages before the raw window. Fire-and-forget — never blocks the response.
//
//   Injection: summaries are prepended to the system prompt before the raw messages.
//   LLM sees: [system prompt] + [summaries] + [raw last 20 messages] + [memory context]

import { getSummarizer, Summarizer } from './summarizer'
import { getMemoryStore } from './memory-store'

const RAW_WINDOW_SIZE = 20  // matches frontend's slice(-20)

interface ChatMessage {
  role: string
  content: string
}

/**
 * Get the cursor (first unsummarized message index) for a session.
 */
async function getCursor(sessionId: string): Promise<number> {
  const summaries = await getMemoryStore().getConversationSummaries(sessionId)
  if (summaries.length === 0) return 0
  return Math.max(...summaries.map(s => s.turnEnd)) + 1
}

/**
 * Build the summary injection block for the system prompt.
 * Returns empty string if no summaries exist.
 */
export async function buildSummaryInjection(
  sessionId: string,
  characterId = 'aimee'
): Promise<string> {
  const summaries = await getMemoryStore().getConversationSummaries(sessionId, characterId)
  if (summaries.length === 0) return ''

  const blocks = summaries.map(s =>
    `[Earlier in this conversation (turns ${s.turnStart}–${s.turnEnd}): ${s.summary}]`
  )
  return `Compressed conversation history:\n${blocks.join('\n')}`
}

/**
 * Trigger compression if needed. Fire-and-forget — call without await.
 *
 * Reads all messages for the session from the DB, identifies the unsummarized
 * range (cursor → rawWindowStart-1), and compresses it via the Summarizer.
 */
export async function maybeCompress(
  sessionId: string,
  characterId = 'aimee',
  summarizer: Summarizer = getSummarizer()
): Promise<void> {
  try {
    const allMessages = await getMemoryStore().getSessionMessages(sessionId)
    const total = allMessages.length

    if (total <= RAW_WINDOW_SIZE) return  // nothing to compress yet

    const cursor = await getCursor(sessionId)
    const rawWindowStart = Math.max(0, total - RAW_WINDOW_SIZE)

    if (cursor >= rawWindowStart) return  // already caught up

    // Messages to compress: from cursor up to (not including) the raw window
    const toCompress = allMessages.slice(cursor, rawWindowStart)
    if (toCompress.length < 5) return  // not worth compressing tiny ranges

    const input = toCompress
      .map((m, i) => `[Turn ${cursor + i}] ${m.role}: ${m.content.slice(0, 500)}`)
      .join('\n\n')

    const systemPrompt = [
      'You are summarizing a conversation between a user and an AI assistant.',
      'Create a concise summary (3–5 sentences) capturing:',
      '- Key topics discussed',
      '- Important facts, decisions, or preferences expressed',
      '- Overall conversational context',
      'This summary will be prepended to future prompts so the AI remembers past context.',
      'Be factual and specific. Do not editorialize. Write in third person.',
    ].join('\n')

    const summary = await summarizer.summarize(systemPrompt, input)

    await getMemoryStore().addConversationSummary(
      sessionId,
      characterId,
      summary.trim(),
      cursor,
      rawWindowStart - 1
    )
  } catch (e) {
    // Compression is best-effort — never crash the session
    console.error('Compression failed:', e)
  }
}
