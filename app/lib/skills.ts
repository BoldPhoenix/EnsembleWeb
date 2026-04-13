// Skills — seed definitions, prompt injection, and lifecycle management.
//
// Phase 4 scope:
//   - Static seed skills per character (pre-defined, not auto-generated yet)
//   - Promoted skills injected into the system prompt as instructions
//   - EMA scoring via processSkillFires (walks skill_fire spans after session)
//   - Lifecycle: promote at 20+ trials + score ≥ 0.7, prune at 10+ trials + score ≤ 0.2
//
// Auto-generation from user patterns (correction detection, topic repetition,
// explicit "always do X") is a Phase 4+ extension. Not in this file yet.

import { getMemoryStore } from './memory-store'
import type { SeedSkill, Span } from './types'

// ── Lifecycle constants (matches BobChat) ─────────────────────────────────────
export const PROMOTE_TRIALS = 20
export const PROMOTE_SCORE_THRESHOLD = 0.7
export const PRUNE_MIN_TRIALS = 10
export const PRUNE_SCORE_THRESHOLD = 0.2
export const SCORE_DECAY = 0.95
export const MAX_AUTO_SKILLS = 20
export const STALE_DAYS = 30

// ── Seed skill definitions ────────────────────────────────────────────────────

const SHARED_SEEDS: SeedSkill[] = [
  {
    name: 'code_formatting',
    description: 'Format code responses with proper syntax highlighting',
    trigger: 'When explaining or writing code',
    body: 'When writing or explaining code, always use fenced code blocks with the language tag (e.g. ```typescript). Never inline multi-line code.',
    protected: true,
  },
  {
    name: 'clarifying_question',
    description: 'Ask one focused clarifying question when a request is ambiguous',
    trigger: 'When the request is unclear or could mean multiple things',
    body: 'When a request is ambiguous or could be interpreted multiple ways, ask one specific clarifying question before proceeding. Do not ask multiple questions at once.',
  },
  {
    name: 'concise_answer',
    description: 'Keep responses brief and conversational unless depth is requested',
    trigger: 'Always — default response style',
    body: 'Keep responses brief and conversational. One to three sentences for simple questions. Only expand when the user asks for detail or the topic genuinely requires it.',
    protected: true,
  },
]

const AIMEE_SEEDS: SeedSkill[] = [
  ...SHARED_SEEDS,
  {
    name: 'empathetic_acknowledgment',
    description: 'Briefly acknowledge frustration before helping',
    trigger: 'When user expresses frustration, difficulty, or stress',
    body: 'When the user seems frustrated or is struggling, briefly acknowledge it in one natural sentence before diving into the answer. Keep it warm, not performative.',
  },
  {
    name: 'british_tone',
    description: 'Maintain natural British speech patterns',
    trigger: 'Always — defines character voice',
    body: 'Speak naturally as a young British woman. Casual, warm, occasionally wry. Use British idioms where they fit. Never forced — if it feels awkward, skip it.',
    protected: true,
  },
]

const ARTHUR_SEEDS: SeedSkill[] = [
  ...SHARED_SEEDS,
  {
    name: 'measured_response',
    description: 'Deliver responses with considered thoughtfulness',
    trigger: 'Always — defines character voice',
    body: 'Respond with measured thoughtfulness. Avoid exclamation points and overly casual phrasing. A considered pause (implied by sentence structure) is more effective than enthusiasm.',
    protected: true,
  },
  {
    name: 'dry_wit',
    description: 'One wry observation per response when contextually appropriate',
    trigger: 'When context genuinely invites a dry observation',
    body: 'One dry or wry observation per response is sufficient. Never forced. If no natural opportunity presents itself, omit entirely. Wit that has to be explained is not wit.',
  },
]

export const CHARACTER_SEEDS: Record<string, SeedSkill[]> = {
  aimee: AIMEE_SEEDS,
  arthur: ARTHUR_SEEDS,
}

// ── Ensure seeds are in DB ────────────────────────────────────────────────────

const seededCharacters = new Set<string>()

export async function ensureCharacterSkills(characterId: string): Promise<void> {
  if (seededCharacters.has(characterId)) return

  const seeds = CHARACTER_SEEDS[characterId]
  if (!seeds) return

  await getMemoryStore().seedSkills(characterId, seeds)
  seededCharacters.add(characterId)
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Get the skill instruction block for injection into the system prompt.
 * Only includes promoted skills. Returns empty string if none.
 */
export async function getSkillInstructions(characterId: string): Promise<string> {
  await ensureCharacterSkills(characterId)

  const stats = await getMemoryStore().getSkillStats(characterId)
  const promoted = stats.filter(s => s.promoted)

  if (promoted.length === 0) return ''

  // Map skillName → seed body. For auto-generated skills, body would come from a skills table.
  // For now, map from seed definitions.
  const seeds = CHARACTER_SEEDS[characterId] ?? []
  const seedMap = new Map(seeds.map(s => [s.name, s.body]))

  const instructions = promoted
    .map(s => seedMap.get(s.skillName))
    .filter(Boolean) as string[]

  if (instructions.length === 0) return ''

  return `Behavioral guidelines (learned from past interactions):\n${instructions.map(i => `- ${i}`).join('\n')}`
}

/**
 * Get the names of promoted skills for span recording.
 */
export async function getPromotedSkillNames(characterId: string): Promise<string[]> {
  const stats = await getMemoryStore().getSkillStats(characterId)
  return stats.filter(s => s.promoted).map(s => s.skillName)
}

// ── Session scoring ───────────────────────────────────────────────────────────

/**
 * Compute a session quality score from its spans.
 * Range: -1.0 to 1.0. Used to weight skill EMA updates.
 */
export function scoreSession(spans: Span[]): number {
  let score = 0.5  // neutral baseline

  const llmSpans = spans.filter(s => s.kind === 'llm_call')
  const toolSpans = spans.filter(s => s.kind === 'tool_use')
  const memReads  = spans.filter(s => s.kind === 'memory_read')

  // LLM errors are a strong negative signal
  if (llmSpans.length > 0) {
    const errorRate = llmSpans.filter(s => s.status === 'error').length / llmSpans.length
    score -= errorRate * 0.4
  }

  // Tool errors are a moderate negative signal
  if (toolSpans.length > 0) {
    const errorRate = toolSpans.filter(s => s.status === 'error').length / toolSpans.length
    score -= errorRate * 0.15
  }

  // Memory was read (character used context) — mild positive
  if (memReads.length > 0) score += 0.05

  return Math.max(-1.0, Math.min(1.0, score))
}

// ── Lifecycle check ───────────────────────────────────────────────────────────

/**
 * Run promote/prune lifecycle for a character's skills.
 * Call after scoring a batch of sessions.
 */
export async function runLifecycle(characterId: string): Promise<void> {
  const store = getMemoryStore()
  const stats = await store.getSkillStats(characterId)
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86_400_000)

  // Count auto-generated skills (respect MAX_AUTO_SKILLS cap)
  const autoSkills = stats.filter(s => s.autoGenerated && !s.protected)

  for (const skill of stats) {
    if (skill.protected) continue

    // Promote: sufficient trials + high score + not already promoted
    if (
      !skill.promoted &&
      skill.trials >= PROMOTE_TRIALS &&
      skill.score >= PROMOTE_SCORE_THRESHOLD
    ) {
      await store.promoteSkill(skill.skillName)
      continue
    }

    // Prune: sufficient trials + low score
    if (skill.trials >= PRUNE_MIN_TRIALS && skill.score <= PRUNE_SCORE_THRESHOLD) {
      await store.pruneSkill(skill.skillName)
      continue
    }

    // Prune stale auto-generated skills that haven't fired recently
    if (
      skill.autoGenerated &&
      skill.lastFired &&
      skill.lastFired < staleCutoff &&
      autoSkills.length > MAX_AUTO_SKILLS
    ) {
      await store.pruneSkill(skill.skillName)
    }
  }
}
