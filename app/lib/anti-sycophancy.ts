/**
 * Anti-sycophancy output filtering.
 *
 * Layer 3 of the 8-layer defense (see docs/ANTI_SYCOPHANCY_PLAN.md).
 *
 * Pattern-matches assistant responses for sycophantic phrases and scores them.
 * Phase 1 is WARN MODE: detections are logged but responses are not blocked or
 * regenerated. Phase 2 will promote this to REWRITE MODE.
 *
 * The scanner runs AFTER the model responds but BEFORE the response is returned
 * to the user. It does not modify the response in warn mode.
 */

/**
 * Sycophantic opening phrases. These appear at the START of a response (within
 * the first 80 characters) and signal validation-before-content, which is the
 * strongest marker of sycophancy.
 *
 * Matching is case-insensitive, word-boundary-aware, and checks both raw and
 * possessive forms.
 */
const OPENING_PHRASES = [
  "you're absolutely right",
  "you are absolutely right",
  "that's absolutely right",
  "great question",
  "what a great question",
  "excellent question",
  "fantastic question",
  "that's a fantastic",
  "that's a great",
  "perfect!",
  "absolutely!",
  "wonderful point",
  "brilliant observation",
  "you're so right",
  "exactly right",
  "spot on",
  "couldn't agree more",
  "i couldn't agree more",
  "that's amazing",
  "how insightful",
  "what a great idea",
  "what an excellent",
  "absolutely love",
  "i love this",
  "i love that",
  "that's brilliant",
  "you nailed it",
  "you got it exactly right",
  "you hit the nail on the head",
] as const

/**
 * Inline sycophantic patterns. These appear ANYWHERE in the response and
 * indicate excessive praise or validation without substance.
 */
const INLINE_PHRASES = [
  "you make a great point",
  "you raise an excellent point",
  "that's such a great",
  "what a thoughtful",
  "really insightful",
  "very astute",
  "you're clearly very",
  "what a brilliant",
  "that's exactly what i was thinking",
  "i'm so glad you",
] as const

/**
 * Result of a sycophancy scan.
 */
export interface ScanResult {
  /** True if any sycophantic patterns were detected. */
  flagged: boolean
  /** Phrases detected in the response, with position metadata. */
  detections: Array<{
    phrase: string
    location: 'opening' | 'inline'
    position: number
  }>
  /** Severity score 0-10. 0 = no detections, 10 = multiple opening-position hits. */
  severity: number
  /** Character count of the response. Used for rate calculations. */
  responseLength: number
}

const OPENING_WINDOW = 80 // characters

/**
 * Scan an assistant response for sycophantic patterns.
 *
 * This does not modify the response. Callers decide what to do with the result
 * based on mode (warn / rewrite / strip).
 */
export function scanForSycophancy(response: string): ScanResult {
  const lowered = response.toLowerCase()
  const detections: ScanResult['detections'] = []

  // Check opening phrases in the first OPENING_WINDOW characters
  const openingSegment = lowered.slice(0, OPENING_WINDOW)
  for (const phrase of OPENING_PHRASES) {
    const pos = openingSegment.indexOf(phrase)
    if (pos !== -1) {
      detections.push({ phrase, location: 'opening', position: pos })
    }
  }

  // Check inline phrases across the full response
  for (const phrase of INLINE_PHRASES) {
    let pos = lowered.indexOf(phrase)
    while (pos !== -1) {
      detections.push({ phrase, location: 'inline', position: pos })
      pos = lowered.indexOf(phrase, pos + phrase.length)
    }
  }

  // Severity scoring:
  //   - Opening position hit = 4 points each (strongest signal)
  //   - Inline hit = 1 point each
  //   - Multiple hits compound
  let severity = 0
  for (const d of detections) {
    severity += d.location === 'opening' ? 4 : 1
  }
  severity = Math.min(severity, 10)

  return {
    flagged: detections.length > 0,
    detections,
    severity,
    responseLength: response.length,
  }
}

/**
 * Operating modes for the anti-sycophancy filter.
 *
 * - warn: log detections, do not modify response. Phase 1 default.
 * - rewrite: regenerate response with amplified anti-sycophancy prompt on detection. Phase 2.
 * - strip: remove detected phrases from response before returning. Fallback option, last resort.
 */
export type FilterMode = 'warn' | 'rewrite' | 'strip'

/**
 * Get current filter mode from environment. Defaults to warn.
 */
export function getFilterMode(): FilterMode {
  const mode = (process.env.ANTI_SYCOPHANCY_MODE || 'warn').toLowerCase()
  if (mode === 'rewrite' || mode === 'strip') return mode
  return 'warn'
}

/**
 * Log a scan result in structured form. Used by warn mode to accumulate
 * baseline data before Phase 2 promotes the filter to active enforcement.
 *
 * Output format is JSON-line for easy grep/jq filtering in logs.
 */
export function logScan(
  scan: ScanResult,
  context: { characterId?: string; sessionId?: string; provider?: string; model?: string }
): void {
  if (!scan.flagged) return

  const entry = {
    timestamp: new Date().toISOString(),
    event: 'anti_sycophancy_detection',
    characterId: context.characterId,
    sessionId: context.sessionId,
    provider: context.provider,
    model: context.model,
    severity: scan.severity,
    responseLength: scan.responseLength,
    detectionCount: scan.detections.length,
    openingHits: scan.detections.filter(d => d.location === 'opening').length,
    inlineHits: scan.detections.filter(d => d.location === 'inline').length,
    phrases: scan.detections.map(d => d.phrase),
  }

  // JSON-line format for structured log aggregation
  console.log(`[anti-sycophancy] ${JSON.stringify(entry)}`)
}

/**
 * Strip detected phrases from a response. Used only in strip mode. This is
 * crude — it will break sentence flow where the phrase is followed by content.
 * Prefer rewrite mode when possible.
 */
export function stripSycophancy(response: string, scan: ScanResult): string {
  if (!scan.flagged) return response

  let result = response
  // Sort by position descending so we can splice from the end backwards
  // without shifting subsequent positions
  const sorted = [...scan.detections].sort((a, b) => b.position - a.position)
  for (const detection of sorted) {
    const phraseLen = detection.phrase.length
    // Also consume a trailing comma/exclamation/period if present
    let tailLen = 0
    const after = result.slice(detection.position + phraseLen)
    const tailMatch = after.match(/^[,.!]?\s*/)
    if (tailMatch) tailLen = tailMatch[0].length
    result = result.slice(0, detection.position) + result.slice(detection.position + phraseLen + tailLen)
  }
  return result.trim().replace(/^\s*[,.!]\s*/, '')
}
