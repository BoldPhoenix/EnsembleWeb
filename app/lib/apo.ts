// APO — Automatic Prompt Optimization via beam search over skill variants.
//
// Runs as a triggered batch job, NOT continuously. Trigger conditions:
//   - A skill has ≥ APO_MIN_TRIALS trials since last APO run
//   - Score delta > APO_SCORE_DELTA_THRESHOLD between runs
//
// Flow:
//   1. Identify candidate skills (high trials, non-protected, not recently optimized)
//   2. For each candidate: generate BEAM_WIDTH prompt variants via Summarizer
//   3. Score each variant against recent session spans where that skill fired
//   4. If best variant scores > 10% higher than current, create a SkillProposal
//   5. User accepts/rejects in settings ("How [Name] Grows"). Auto-accept after 7 days.
//
// The Summarizer interface abstracts the LLM call — works with OpenRouter, Gemini, or Ollama.

import { getMemoryStore } from './memory-store'
import { getSummarizer } from './summarizer'
import { CHARACTER_SEEDS, scoreSession, SCORE_DECAY } from './skills'
import type { SkillStat, Span } from './types'

const APO_MIN_TRIALS = 5
const APO_SCORE_DELTA_THRESHOLD = 0.15
const BEAM_WIDTH = 3
const AUTO_ACCEPT_DAYS = 7

interface ApoCandidate {
  stat: SkillStat
  currentBody: string
}

function getSkillBody(skillName: string, characterId: string): string | null {
  const seeds = CHARACTER_SEEDS[characterId] ?? []
  const seed = seeds.find(s => s.name === skillName)
  return seed?.body ?? null
}

async function getRecentSessionSpansForSkill(
  skillName: string
): Promise<{ sessionId: string; spans: Span[] }[]> {
  const store = getMemoryStore()
  const sessions = await store.getRecentSessions(20)
  const results: { sessionId: string; spans: Span[] }[] = []

  for (const session of sessions) {
    const spans = await store.querySpans(session.id)
    const hasSkillFire = spans.some(
      s => s.kind === 'skill_fire' &&
        (s.metadata as { skillName?: string } | null)?.skillName === skillName
    )
    if (hasSkillFire) {
      results.push({ sessionId: session.id, spans })
    }
    if (results.length >= 10) break
  }

  return results
}

function scoreSkillVariant(variantBody: string, sessionSpans: { spans: Span[] }[]): number {
  if (sessionSpans.length === 0) return 0
  let total = 0
  for (const { spans } of sessionSpans) {
    total += scoreSession(spans)
  }
  return total / sessionSpans.length
}

async function generateVariants(
  currentBody: string,
  skillName: string,
  characterId: string
): Promise<string[]> {
  const summarizer = getSummarizer()
  const systemPrompt = [
    'You are optimizing a behavioral instruction for an AI character.',
    `Character: ${characterId}. Skill: ${skillName}.`,
    `Generate exactly ${BEAM_WIDTH} alternative versions of the instruction below.`,
    'Each variant should be a complete, standalone instruction (not a diff or summary).',
    'Vary the approach: one tighter, one more detailed, one restructured.',
    'Output ONLY the variants, separated by "---" on its own line.',
    'No commentary, no labels, no numbering.',
  ].join('\n')

  const result = await summarizer.summarize(systemPrompt, `Current instruction:\n${currentBody}`)
  const variants = result
    .split(/^---$/m)
    .map(v => v.trim())
    .filter(v => v.length > 10 && v.length < 1000)

  return variants.slice(0, BEAM_WIDTH)
}

async function findCandidates(): Promise<ApoCandidate[]> {
  const store = getMemoryStore()
  const allStats = await store.getSkillStats()
  const candidates: ApoCandidate[] = []

  for (const stat of allStats) {
    if (stat.protected) continue
    if (stat.trials < APO_MIN_TRIALS) continue

    const body = getSkillBody(stat.skillName, stat.characterId)
    if (!body) continue

    const pendingProposals = await store.getSkillProposals(stat.characterId)
    if (pendingProposals.some(p => p.skillName === stat.skillName)) continue

    candidates.push({ stat, currentBody: body })
  }

  return candidates
}

export async function runApo(): Promise<number> {
  const candidates = await findCandidates()
  let proposalsCreated = 0

  for (const candidate of candidates) {
    try {
      const sessionSpans = await getRecentSessionSpansForSkill(candidate.stat.skillName)
      if (sessionSpans.length < 3) continue

      const currentScore = scoreSkillVariant(candidate.currentBody, sessionSpans)
      const variants = await generateVariants(
        candidate.currentBody,
        candidate.stat.skillName,
        candidate.stat.characterId
      )

      let bestVariant = candidate.currentBody
      let bestScore = currentScore

      for (const variant of variants) {
        const variantScore = scoreSkillVariant(variant, sessionSpans)
        if (variantScore > bestScore) {
          bestScore = variantScore
          bestVariant = variant
        }
      }

      const improvement = bestScore - currentScore
      if (improvement < APO_SCORE_DELTA_THRESHOLD) continue
      if (bestVariant === candidate.currentBody) continue

      const autoAcceptAt = new Date(Date.now() + AUTO_ACCEPT_DAYS * 86_400_000)
      await getMemoryStore().createSkillProposal(
        candidate.stat.skillName,
        candidate.stat.characterId,
        candidate.currentBody,
        bestVariant,
        `Score improved by ${(improvement * 100).toFixed(0)}% across ${sessionSpans.length} recent sessions`,
        autoAcceptAt
      )
      proposalsCreated++
    } catch (e) {
      console.error(`APO failed for skill ${candidate.stat.skillName}:`, e)
    }
  }

  return proposalsCreated
}
