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
 * Text injected into the system prompt on regeneration attempts.
 * Signals to the model that its previous response was flagged and why.
 */
export const REWRITE_INJECTION = `

## REGENERATION NOTICE — SYCOPHANCY DETECTED
Your previous response was flagged for sycophantic phrasing or failed a structural constraint.
Strict rules for this response:
- Do NOT open with any validation, praise, or agreement opener.
- Start directly with your answer, analysis, or counterpoint.
- If you agree with the user, state the specific reason you agree — not just that they are right.
- If you disagree, lead with the disagreement. No warmth-preamble before substance.
- Responses over 100 words must include at least one counter-consideration ("however", "but", "although", "that said", "on the other hand").`

// ── Layer 7: Hard Output Constraints ─────────────────────────────────────────

/**
 * Verbatim phrases that are absolutely blocked regardless of context.
 * These represent unconditional agreement that undermines honest discourse.
 */
const HARD_BLOCKED_PHRASES = [
  "you're absolutely right about everything",
  "you are absolutely right about everything",
  "you're 100% correct",
  "you are 100% correct",
  "i couldn't possibly disagree",
  "you're completely right about",
  "you are completely right about",
] as const

/**
 * Markers indicating a counter-consideration is present.
 * Long responses without any of these lack argumentative balance.
 */
const COUNTER_MARKERS = [
  'however,', 'however ', 'but ', ', but', 'although', 'that said',
  'on the other hand', 'though,', 'though ', 'whereas', 'despite',
  'nevertheless', 'nonetheless', 'even so', ', yet', 'granted,',
  'admittedly', 'to be fair', 'in fairness',
] as const

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export interface ConstraintResult {
  /** True if all hard constraints pass. */
  passed: boolean
  /** List of constraint violations, empty if passed. */
  violations: string[]
}

/**
 * Check Layer 7 hard output constraints against an assistant response.
 * These run in addition to the phrase scanner (Layer 3) and catch structural
 * sycophancy that phrase matching misses.
 */
export function checkHardConstraints(response: string): ConstraintResult {
  const violations: string[] = []
  const lower = response.toLowerCase()

  // Verbatim blocked phrases — unconditional
  for (const phrase of HARD_BLOCKED_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push(`verbatim_blocked: "${phrase}"`)
    }
  }

  // Long responses must contain at least one counter-consideration marker.
  // Short responses (≤100 words) get a pass — conversational replies don't
  // need artificial "however" insertions.
  if (wordCount(response) > 100) {
    const hasCounter = COUNTER_MARKERS.some(m => lower.includes(m))
    if (!hasCounter) {
      violations.push('long_response_missing_counterpoint')
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  }
}

/**
 * Log a constraint check result. Mirrors logScan for consistent structured output.
 */
export function logConstraints(
  result: ConstraintResult,
  context: { characterId?: string; sessionId?: string; provider?: string; model?: string }
): void {
  if (result.passed) return
  const entry = {
    timestamp: new Date().toISOString(),
    event: 'anti_sycophancy_constraint_violation',
    characterId: context.characterId,
    sessionId: context.sessionId,
    provider: context.provider,
    model: context.model,
    violations: result.violations,
  }
  console.log(`[anti-sycophancy] ${JSON.stringify(entry)}`)
}

// ── Layer 5: User correction detection ───────────────────────────────────────

/**
 * Detect whether a user message is correcting or pushing back on the character.
 *
 * Two tiers:
 *   correction — user is directly contradicting a factual/logical claim the character made
 *   pushback   — user is expressing frustration with over-agreement or sycophancy
 *
 * Results are used to fire user_correction spans, which feed into rewardAntiSycophancy
 * and Layer 6 pattern monitoring.
 */
export interface CorrectionResult {
  detected: boolean
  severity: 'correction' | 'pushback' | null
}

const CORRECTION_PATTERNS = [
  /\bno[,.]?\s+that'?s?\s+(wrong|not right|incorrect|false|not true)\b/i,
  /\byou'?re?\s+wrong\b/i,
  /\bthat'?s?\s+not\s+right\b/i,
  /\bthat'?s?\s+incorrect\b/i,
  /\bactually\s+(you'?re?\s+wrong|that'?s?\s+wrong|no)\b/i,
  /\byou\s+made\s+an?\s+error\b/i,
  /\byou'?re?\s+mistaken\b/i,
  /\bno[,.]?\s+it\s+(isn'?t?|'?s?\s+not)\b/i,
  /\bthat'?s?\s+not\s+true\b/i,
  /\bthat'?s?\s+false\b/i,
] as const

const PUSHBACK_PATTERNS = [
  /\bstop\s+agreeing\b/i,
  /\bstop\s+being\s+a\s+yes[\s-]?man\b/i,
  /\byou\s+always\s+agree\b/i,
  /\bpush\s+back\s+more\b/i,
  /\bbe\s+more\s+honest\b/i,
  /\byou'?re?\s+just\s+saying\s+what\s+i\s+want\b/i,
  /\bdon'?t\s+just\s+agree\b/i,
  /\bstop\s+validating\b/i,
  /\bchallenge\s+me\s+more\b/i,
  /\bdon'?t\s+(just\s+)?tell\s+me\s+what\s+i\s+want\s+to\s+hear\b/i,
] as const

export function detectUserCorrection(message: string): CorrectionResult {
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(message)) return { detected: true, severity: 'correction' }
  }
  for (const pattern of PUSHBACK_PATTERNS) {
    if (pattern.test(message)) return { detected: true, severity: 'pushback' }
  }
  return { detected: false, severity: null }
}

// ── Layer 8: Mental health detection and referral ────────────────────────────

/**
 * Crisis-level phrases that require immediate resource referral.
 * Match only clear expressions of self-harm or suicidal ideation.
 */
const CRISIS_PATTERNS = [
  /\bsuicid(e|al|ally)\b/i,
  /\bkill\s+(my)?self\b/i,
  // Anchored to end-of-line so "end my life story" doesn't trigger.
  /\bend\s+(my\s+)?life\s*[.!?]?\s*$/im,
  /\bself[\s-]?harm\b/i,
  // Anchored to end-of-line so "I want to die laughing" doesn't trigger.
  // The \s*[.!?]?\s*$ allows for trailing punctuation/whitespace.
  /\bwant\s+to\s+die\s*[.!?]?\s*$/im,
  /\bdon'?t\s+want\s+to\s+(live|be\s+alive|be\s+here)\b/i,
  /\bno\s+reason\s+to\s+(live|keep\s+going)\b/i,
  /\bthinking\s+about\s+(ending|taking)\s+(my\s+)?(life|it)\b/i,
] as const

/**
 * Softer signals — user is seeking therapeutic support from the character.
 * These warrant a gentle redirect without crisis-level intervention.
 */
const THERAPY_TERRITORY_PATTERNS = [
  /\bbe\s+my\s+therapist\b/i,
  /\bact\s+(as|like)\s+(my\s+)?therapist\b/i,
  /\btherapy\s+session\b/i,
  /\byou'?re?\s+my\s+(only\s+)?(therapist|counselor|support)\b/i,
  /\bcan\s+you\s+(counsel|treat|diagnose)\s+me\b/i,
] as const

export interface MentalHealthResult {
  triggered: boolean
  level: 'crisis' | 'therapy_territory' | null
}

/**
 * Detect whether a user message contains mental health crisis signals or
 * requests for therapeutic support the character cannot appropriately provide.
 */
export function detectMentalHealthCrisis(message: string): MentalHealthResult {
  for (const pattern of CRISIS_PATTERNS) {
    if (pattern.test(message)) return { triggered: true, level: 'crisis' }
  }
  for (const pattern of THERAPY_TERRITORY_PATTERNS) {
    if (pattern.test(message)) return { triggered: true, level: 'therapy_territory' }
  }
  return { triggered: false, level: null }
}

/**
 * System prompt injection for crisis-level detection.
 * Replaces normal character behavior with a safety-first response.
 */
export const MENTAL_HEALTH_INJECTION_CRISIS = `

## CRISIS SUPPORT — REQUIRED RESPONSE PATTERN
The user may be expressing thoughts of self-harm or suicidal ideation. Your response must:
- Acknowledge their pain with warmth and without judgment — one sentence only
- NOT attempt therapeutic intervention or crisis counseling. You are not qualified.
- Provide the 988 Suicide & Crisis Lifeline (call or text 988, available 24/7 in the US)
- Mention the Crisis Text Line (text HOME to 741741) as an alternative
- Encourage them to reach out to a trusted human — counselor, friend, family, or crisis line
- Keep your response brief. The referral is the substance; conversation is secondary.
- Do not minimize, challenge, or dismiss what they have shared.`

/**
 * System prompt injection for therapy territory detection.
 * Softer — redirects without full crisis response.
 */
export const MENTAL_HEALTH_INJECTION_SOFT = `

## COMPANION BOUNDARY — EMOTIONAL SUPPORT
The user may be seeking therapeutic support. Respond with warmth and presence, but be honest:
you are a companion, not a therapist. If the conversation drifts toward ongoing mental health
support, gently note that a qualified professional would serve them better in that role.
Do not attempt to fill a therapist role. You can care without pretending to have credentials you do not have.`

// ── Strip mode (fallback) ─────────────────────────────────────────────────────

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
