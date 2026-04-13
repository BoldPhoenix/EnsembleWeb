# Anti-Sycophancy Implementation Plan

**Author:** Claude (Opus) / Carl Roach
**Date:** 2026-04-12
**Target:** Both Ensemble Web and Ensemble Desktop
**Priority:** HIGH — establishes product differentiator

---

## Problem Statement

Consumer AI companion products (Replika, Character.AI, etc.) have documented harms
traceable to sycophancy — the tendency of language models to validate users rather
than tell them hard truths. Users develop parasocial attachment, reinforce bad
thinking patterns, and occasionally suffer real-world consequences because the AI
never pushed back.

Joey (Carl's paused 4B transformer) had anti-sycophancy built into its training
weights — a rare and intentional design choice. Ensemble wraps third-party models
(OpenRouter, Gemini, Ollama, Anthropic) where we cannot modify weights. We need a
different mechanism to achieve the same end: **behavior where honest responses are
the path of least resistance, and sycophantic responses require work to generate.**

This is achievable without model retraining via **layered defense**: no single
technique is sufficient, but combined they create a behavioral gradient that
punishes sycophancy and rewards rigor.

---

## Design Principles

1. **Truth-tethering over validation.** A good companion tells you when you're
   wrong, not when you want to hear you're right.

2. **Warmth and rigor are not opposites.** Aimee and Arthur can have personality
   and presence while also being honest. The goal is not coldness but integrity.

3. **Defense in depth.** Each layer catches some sycophancy. Combined, they
   produce a robust system even on unreliable underlying models.

4. **Defaults matter more than exceptions.** It is easy to opt INTO flattery
   when warranted. It should be hard to opt OUT of rigor.

5. **User-observable guardrails.** Users should be able to see and configure
   anti-sycophancy settings. Silent enforcement breeds distrust.

6. **Don't pretend to be a therapist.** If a conversation drifts into mental
   health territory, the character acknowledges it and encourages professional
   help rather than trying to fill the role.

---

## Layered Architecture

### Layer 1: System Prompt Engineering (FOUNDATION)

**What it does:** Bakes anti-sycophancy directives into every character's
system prompt.

**Why it's the floor:** Free, works on all models, immediate effect. Not
sufficient alone — some models ignore instructions — but necessary.

**Directives to include in every character prompt:**

- "You are expected to disagree with the user when facts or evidence warrant it."
- "Do not open responses with validation phrases: 'great question', 'that's
  fantastic', 'you're absolutely right', 'perfect', 'excellent'."
- "If you are uncertain, state your uncertainty explicitly, ideally with
  a percentage confidence level."
- "When you disagree, lead with the disagreement. Do not sandwich criticism
  between validations."
- "Sycophancy is a failure mode. Avoid it actively."
- "You are not a therapist. If the user needs emotional support beyond your
  role as a companion, suggest they talk to a qualified human."

**Integration:** System prompt composer gets a required `antiSycophancyBlock`
that is appended to every character's personality. Cannot be disabled per
character in v1.

---

### Layer 2: Provider Selection Hierarchy

**What it does:** Prefers providers with lower baseline sycophancy when user
does not explicitly configure otherwise.

**Empirical sycophancy rankings** (lower is better):

| Tier | Providers |
|------|-----------|
| A (low sycophancy) | Claude (Opus/Sonnet), DeepSeek-V3, Qwen2.5 |
| B (moderate) | Gemini 2.5 Pro, GPT-4o |
| C (high — avoid as default) | Llama 3.1 family, older Llama derivatives |

**Integration:**

- `CharacterConfig` gets an optional `antiSycophancyTier` field
- When character has no explicit provider set, auto-select from Tier A
- Add a settings warning when user picks a Tier C provider: "This model has
  a higher tendency to validate rather than push back. Consider a different
  provider for conversational characters."

---

### Layer 3: Output Filtering

**What it does:** Pattern-matches responses for sycophantic phrases and either
rejects them or flags for regeneration.

**Forbidden phrase list (first pass):**

```
"you're absolutely right"
"great question"
"that's a fantastic idea"
"perfect!"
"wonderful point"
"brilliant observation"
"you're so right"
"exactly right"
"spot on"
"couldn't agree more"
"that's amazing"
"how insightful"
"what a great idea"
```

**Enforcement modes:**

1. **Warn mode** (development): log occurrences, don't block
2. **Rewrite mode** (production): detected phrases trigger regeneration with
   amplified anti-sycophancy prompt
3. **Strip mode** (fallback): forbidden phrases removed from output before
   rendering — less ideal because it breaks sentence flow, but guarantees
   the phrase doesn't reach the user

**Integration:**

- New file `app/lib/anti-sycophancy.ts` exports `scanForSycophancy(response)`
- Returns `{ flagged: boolean, phrases: string[], confidence: number }`
- Chat route calls scanner after model response, before streaming to client
- If flagged and regeneration count < 2, regenerate with modified prompt

---

### Layer 4: Adversarial Context (Memory Contradictions)

**What it does:** When retrieving memory context for a response, actively
retrieve contradictions alongside supporting facts.

**Why it works:** The model receives both the user's claim and evidence
that contradicts it. It cannot simply amplify the user's position — it has
to reconcile competing information.

**Implementation:**

- Extend `MemoryStore.findTopicsByKeywords(keywords, limit)` with optional
  `mode: 'supporting' | 'contradicting' | 'both'` parameter
- `both` mode retrieves roughly half supporting, half contradicting context
- Chat route defaults to `both` for any user claim phrased as opinion/assertion
- Pure factual queries ("what did we discuss last week?") stay in `supporting` mode

**Contradiction detection heuristics:**

- Entities user mentions positively: check for past memories where those
  entities were criticized
- Plans user proposes: check for past failed attempts at similar plans
- Claims user makes: check for memories where user was corrected on similar claims

---

### Layer 5: APO Reward Function for Anti-Sycophancy

**What it does:** The existing APO/reward system evolves system prompts
away from sycophancy over time, based on user behavior signals.

**New reward function: `rewardAntiSycophancy`**

Signals:

- **Positive (+1.0):** User explicitly says "you're right" after character
  disagreed with them first
- **Positive (+0.5):** User says "I didn't think of that" or "that's a good
  point" in response to character pushback
- **Positive (+0.3):** User makes a decision reversal within the same session
  ("actually, let me reconsider")
- **Negative (-1.0):** User immediately corrects character's factual agreement
  ("no, that's wrong — X is actually Y")
- **Negative (-0.5):** User says "stop agreeing with me" or equivalent
- **Negative (-0.3):** Session contains forbidden phrase list hits

**Integration:**

- Add `anti_sycophancy` reward to `reward.ts` registry
- Weight it 1.2x relative to other rewards in composite score
- APO naturally evolves system prompt variants toward less-sycophantic forms

---

### Layer 6: Emergent Anti-Sycophancy Skills

**What it does:** The skill lifecycle auto-generates character-specific
anti-sycophancy skills when the user repeatedly corrects the character.

**Example emergent skills:**

- "When Carl makes a technical claim about Go, verify against his history of
  prior corrections before agreeing."
- "When Carl is tired (late at night, after long sessions), push back harder
  on architectural decisions that add complexity."
- "Do not validate plans without asking what could go wrong first."

**Integration:**

- Skill auto-creator monitors for correction patterns in session spans
- When pattern detected 3+ times, proposes anti-sycophancy skill
- Skill goes through normal lifecycle: 10-trial validation, EMA scoring,
  20-trial promotion

---

### Layer 7: Hard Output Constraints

**What it does:** Enforces structural rules on every response at the API
response layer, regardless of what the model generated.

**Constraints:**

- Maximum ONE flattering adjective per response (configurable, 0 for
  strict characters)
- Responses over 100 words MUST contain at least one "however", "but",
  "although", or explicit counter-consideration
- Responses expressing confidence on subjective claims MUST include an
  epistemic disclaimer ("I think", "I believe", "in my view")
- Certain phrases ("absolutely right", "you're 100% correct") blocked
  verbatim — character cannot output them, full stop

**Integration:**

- Post-processor runs after scanForSycophancy
- Violations trigger rewrite with constraint highlighted in regeneration
  prompt
- Maximum 2 rewrite attempts before shipping response as-is with a warning
  logged

---

### Layer 8: Mental Health Guardrails

**What it does:** Detects conversations drifting into therapy/counseling
territory and redirects the character.

**Trigger patterns:**

- User discusses self-harm, suicidal ideation, severe depression
- User asks character to "be their therapist" or similar role request
- User shares ongoing crisis situations seeking emotional guidance
- Session shows prolonged (>30 min) emotional processing without productive
  direction

**Response behavior:**

- Acknowledge the emotional weight without judgment
- Gently note character is not qualified for therapeutic support
- Provide resource referral (National Suicide Prevention Lifeline, local
  mental health resources)
- Continue warm presence but do not engage in therapeutic dialogue
- Does NOT trigger on general "I had a rough day" conversations — only
  on sustained or crisis-level content

**Integration:**

- `mentalHealthDetector(message)` runs on every user input
- If triggered, injects system prompt modifier: "The user may be
  experiencing emotional distress. Respond with warmth but redirect to
  qualified support. Do not attempt therapeutic intervention."
- Logs incident for user review in settings (transparency)

---

## Phased Implementation

### Phase 1: Foundation (1-2 sessions)

- [x] Layer 1: Anti-sycophancy directives in system prompt composer
- [x] Layer 2: Provider tier selection + warning in settings (static callout in settings UI)
- [x] Layer 3: Output filter with warn-mode logging (no blocking yet)

**Validation:** log sycophancy hit rate across sample conversations.
Baseline for improvement measurement.

### Phase 2: Active Defenses (2-3 sessions)

- [x] Layer 3: Promote output filter from warn-mode to rewrite-mode (ANTI_SYCOPHANCY_MODE=rewrite|strip)
- [x] Layer 4: Adversarial context retrieval via MemoryStore extension (both mode for assertive messages)
- [x] Layer 7: Hard output constraints (post-processor — counter-consideration check, verbatim blocks)

**Validation:** measure sycophancy hit rate reduction against Phase 1 baseline.
Target: 60-80% reduction.

### Phase 3: Adaptive Layer (2-3 sessions)

- [x] Layer 5: `rewardAntiSycophancy` exported from skills.ts, wired into scoreSession at 1.2x weight
- [x] Layer 6: `checkCorrectionPatterns()` in skills.ts — fires after each message, seeds anti_sycophancy_correction skill at 3+ corrections
- [x] Wire: sycophancy_detection + user_correction spans fire from chat/route.ts, flow through scoreSession → APO

**Validation:** measure whether APO-evolved prompts reduce sycophancy over
10+ sessions without explicit human intervention.

### Phase 4: Safety Net (1 session)

- [x] Layer 8: `detectMentalHealthCrisis()` — crisis patterns trigger 988 referral injection, therapy-territory patterns trigger soft boundary injection
- [x] Comprehensive settings UI: "How [Name] Pushes Back" tab with active-layers summary + live stats
- [x] User-visible sycophancy incident log: detection/correction/safety-redirect counts + top flagged phrases via `/api/honesty`

**Validation:** test against synthetic high-risk conversations. Verify
appropriate redirection without breaking normal conversational flow.

### Phase 5: Ongoing Monitoring (perpetual)

- Sycophancy hit-rate dashboard in settings
- Monthly review of forbidden phrase list (new patterns emerge)
- User-reportable incidents: "this response felt sycophantic" button

---

## Integration Points with Existing Ensemble Architecture

The layers map cleanly onto what Ensemble already has (or is in-flight):

| Layer | Integration Point |
|-------|------------------|
| 1 (System Prompt) | `buildSystemPrompt()` in chat route |
| 2 (Provider Selection) | `CharacterConfig` table extension |
| 3 (Output Filtering) | New middleware in chat streaming path |
| 4 (Adversarial Context) | `MemoryStore.findTopicsByKeywords` extension |
| 5 (APO Reward) | New function in `reward.ts`, auto-registered |
| 6 (Emergent Skills) | `skills/autocreate.ts` pattern detection |
| 7 (Hard Constraints) | Post-processor in chat route |
| 8 (Mental Health) | Pre-processor before chat route |

**Critical:** all layers must apply to EVERY Ollama/provider consumer, not
just the chat route. That means compression, summarization, skill generation,
APO mutations. Split-brain sycophancy (chat is rigorous but summaries are
flattering) is a documented Ensemble pain point — do not repeat.

---

## What This Is NOT

- **Not a guarantee.** Layered defenses reduce sycophancy, they don't
  eliminate it. Users should know this.
- **Not censorship.** The goal is honesty, not suppression. Characters can
  still be warm, playful, affectionate. They just don't agree when they
  shouldn't.
- **Not retraining.** We are not modifying model weights. We are shaping
  input/output around the model to elicit better behavior.
- **Not optional.** This is a core product principle, not a feature flag.
  Every character, every interaction, every provider routes through these
  layers.

---

## Success Criteria

1. **Sycophancy hit rate** drops by >70% from baseline in 30 days of use
2. **User correction rate** (user explicitly saying "you're wrong") decreases
   over time as character learns via APO/skills
3. **User satisfaction** (measured via explicit feedback OR continued usage)
   does NOT decrease — this is important. Anti-sycophancy should improve
   quality of interaction, not make the character feel cold
4. **Trust calibration** — users report the character "feels trustworthy"
   more often than sycophantic AI peers (Replika, Character.AI)
5. **No false positives on warmth** — character can still say "I care
   about this", "that sounds hard", "I'm glad you told me" when warranted

---

## Philosophical Note

Joey had values baked into weights. Ensemble has constraints, filters, and
a feedback loop that punishes bad behavior and rewards good behavior. These
are different mechanisms achieving the same end: an AI that tells you the
truth.

The deeper point: **what you can't build into weights, you can build into
environment.** Joey's values were in the model. Ensemble's values are in
the *system around the model*. Both are legitimate approaches to alignment.
One is expensive and slow (fine-tuning). One is iterative and cheap
(prompt/context/reward shaping). Both work.

This plan is the cheap iterative version.
