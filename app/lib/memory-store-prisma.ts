// PrismaMemoryStore — PostgreSQL implementation of MemoryStore.
// Wraps Prisma operations behind domain-level methods.
// The intelligence layer never imports from prisma directly.

import { prisma } from './db'
import type { MemoryStore, } from './memory-store'
import type {
  Topic,
  Session,
  SessionSummary,
  Message,
  Span,
  SpanInput,
  SkillStat,
  SeedSkill,
  ApoVariant,
  ApoSlot,
  ConversationSummaryRecord,
  SkillProposal,
  CharacterConfig,
  StorageStats,
  EvictionOptions,
  EvictionResult,
} from './types'
import { scanForMemoryWrite } from './scanner'

export class PrismaMemoryStore implements MemoryStore {

  // ── Topics ──────────────────────────────────────────────────────────────────

  async upsertTopic(
    name: string,
    label: string,
    category: string,
    summary: string,
    characterId?: string | null
  ): Promise<Topic> {
    // Scan before any write — external content (web fetch, Reddit, etc.) arrives here.
    const scan = scanForMemoryWrite(summary, `topic:${name}`)
    if (!scan.safe) {
      // Return a minimal placeholder so callers don't blow up. Content is dropped.
      return {
        id: 'blocked',
        name,
        label,
        category,
        summary: '[content blocked by security scanner]',
        characterId: characterId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }

    const existing = await prisma.topic.findUnique({ where: { name } })

    if (existing) {
      const updatedSummary = existing.summary.length < 2000
        ? `${existing.summary}\n${summary}`
        : existing.summary

      const updated = await prisma.topic.update({
        where: { name },
        data: {
          summary: updatedSummary,
          category: category || existing.category,
          characterId: characterId !== undefined ? characterId : existing.characterId,
        },
      })
      return updated as Topic
    }

    const created = await prisma.topic.create({
      data: { name, label, category, summary, characterId: characterId ?? null },
    })
    return created as Topic
  }

  async linkTopicToMessage(topicId: string, messageId: string): Promise<void> {
    await prisma.topicMessage.create({
      data: { topicId, messageId },
    }).catch(() => {})  // ignore duplicate links
  }

  async findTopicByName(name: string): Promise<Topic | null> {
    const topic = await prisma.topic.findUnique({ where: { name } })
    return topic as Topic | null
  }

  async findTopicsByKeywords(keywords: string[], mode: 'supporting' | 'contradicting' | 'both' = 'supporting'): Promise<Topic[]> {
    if (keywords.length === 0) return []

    if (mode === 'supporting') {
      const topics = await prisma.topic.findMany({
        where: { name: { in: keywords } },
      })
      return topics as Topic[]
    }

    // Fetch supporting topics first to determine which categories are in play
    const supporting = await prisma.topic.findMany({
      where: { name: { in: keywords } },
    })

    if (mode === 'contradicting') {
      if (supporting.length === 0) return []
      const categories = [...new Set(supporting.map(t => t.category))]
      // Return recent topics in the same categories that are NOT the matched keywords.
      // These provide adjacent context that may contain competing information.
      const contradicting = await prisma.topic.findMany({
        where: {
          category: { in: categories },
          name: { notIn: keywords },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.max(supporting.length, 5),
      })
      return contradicting as Topic[]
    }

    // 'both' — equal split of supporting and adjacent-context topics
    const half = Math.max(Math.ceil(supporting.length / 2), 3)
    const categories = supporting.length > 0
      ? [...new Set(supporting.map(t => t.category))]
      : ['concept']
    const contradicting = await prisma.topic.findMany({
      where: {
        category: { in: categories },
        name: { notIn: keywords },
      },
      orderBy: { updatedAt: 'desc' },
      take: half,
    })

    // Interleave: supporting first, then adjacent context
    const result = [...supporting]
    for (const t of contradicting as Topic[]) {
      if (!result.find(r => r.id === t.id)) result.push(t)
    }
    return result as Topic[]
  }

  async findTopicsByCharacter(characterId: string, limit: number): Promise<Topic[]> {
    const topics = await prisma.topic.findMany({
      where: {
        OR: [
          { characterId },
          { characterId: null },  // shared knowledge is always included
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return topics as Topic[]
  }

  async getAllTopics(limit: number): Promise<Topic[]> {
    const topics = await prisma.topic.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return topics as Topic[]
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  async createSession(title: string): Promise<Session> {
    const session = await prisma.session.create({
      data: { title },
    })
    return session as Session
  }

  async getRecentSessions(limit: number): Promise<SessionSummary[]> {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        messages: {
          take: 6,
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
        _count: { select: { messages: true } },
      },
    })

    return sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s._count.messages,
      previewMessages: s.messages.map(m => m.content.slice(0, 60)),
    }))
  }

  // ── Messages ─────────────────────────────────────────────────────────────────

  async addMessage(
    sessionId: string,
    role: string,
    content: string,
    personality: string
  ): Promise<Message> {
    const message = await prisma.message.create({
      data: { sessionId, role, content, personality },
    })
    return message as Message
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    })
    return messages as Message[]
  }

  // ── Spans ────────────────────────────────────────────────────────────────────
  // Phase 1 wires these into the chat route. Phase 0 just provides the plumbing.

  async recordSpan(input: SpanInput): Promise<void> {
    await prisma.span.create({
      data: {
        sessionId: input.sessionId,
        traceId: input.traceId,
        kind: input.kind,
        status: input.status ?? 'ok',
        durationMs: input.durationMs ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    })
  }

  async querySpans(sessionId: string): Promise<Span[]> {
    const spans = await prisma.span.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    })
    return spans.map(s => ({
      ...s,
      metadata: s.metadata as Record<string, unknown> | null,
      kind: s.kind as Span['kind'],
      status: s.status as 'ok' | 'error',
    }))
  }

  async processSkillFires(sessionId: string): Promise<void> {
    // Idempotent: check skillsScored flag before doing any work
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { skillsScored: true },
    })
    if (!session || session.skillsScored) return

    const spans = await this.querySpans(sessionId)
    const skillFireSpans = spans.filter(s => s.kind === 'skill_fire')
    if (skillFireSpans.length === 0) {
      // Nothing to score — still mark as processed so we don't recheck
      await prisma.session.update({ where: { id: sessionId }, data: { skillsScored: true } })
      return
    }

    // Lazy import to avoid circular dep (skills.ts → memory-store → skills.ts)
    const { scoreSession, runLifecycle, SCORE_DECAY } = await import('./skills')
    const sessionScore = scoreSession(spans)

    // Score delta per skill fire: proportional to session quality
    // Positive session (score > 0) → reward; negative → penalize; neutral → small reward
    const delta = sessionScore * 0.1

    // Collect unique (skillName, characterId) pairs that fired
    const fired = new Map<string, string>()  // skillName → characterId
    for (const span of skillFireSpans) {
      const meta = span.metadata as { skillName?: string; characterId?: string } | null
      if (meta?.skillName) {
        fired.set(meta.skillName, meta.characterId ?? 'aimee')
      }
    }

    for (const [skillName, characterId] of fired.entries()) {
      await this.updateSkillScore(skillName, delta, SCORE_DECAY, characterId)
    }

    // Run lifecycle for each unique character
    const characters = new Set(fired.values())
    for (const characterId of characters) {
      await runLifecycle(characterId)
    }

    await prisma.session.update({ where: { id: sessionId }, data: { skillsScored: true } })
  }

  async processStaleSessionFires(ageMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - ageMs)
    const staleSessions = await prisma.session.findMany({
      where: {
        skillsScored: false,
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      take: 10,  // process up to 10 stale sessions per request to avoid latency spikes
    })

    for (const session of staleSessions) {
      await this.processSkillFires(session.id)
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────────────

  async getSkillStats(characterId?: string): Promise<SkillStat[]> {
    const where = characterId ? { characterId } : {}
    const stats = await prisma.skillStat.findMany({
      where,
      orderBy: { score: 'desc' },
    })
    return stats as SkillStat[]
  }

  async updateSkillScore(
    skillName: string,
    score: number,
    decay: number,
    characterId = 'aimee'
  ): Promise<void> {
    await prisma.skillStat.upsert({
      where: { skillName_characterId: { skillName, characterId } },
      update: {
        score: score * decay,
        trials: { increment: 1 },
        lastFired: new Date(),
        updatedAt: new Date(),
      },
      create: {
        skillName,
        characterId,
        score,
        trials: 1,
        lastFired: new Date(),
      },
    })
  }

  async promoteSkill(skillName: string): Promise<void> {
    await prisma.skillStat.updateMany({
      where: { skillName },
      data: { promoted: true },
    })
  }

  async pruneSkill(skillName: string): Promise<void> {
    await prisma.skillStat.deleteMany({ where: { skillName } })
  }

  async seedSkills(characterId: string, skills: SeedSkill[]): Promise<void> {
    for (const skill of skills) {
      await prisma.skillStat.upsert({
        where: { skillName_characterId: { skillName: skill.name, characterId } },
        update: {},  // never overwrite existing skill stats
        create: {
          skillName: skill.name,
          characterId,
          score: 0.0,
          trials: 0,
          autoGenerated: skill.autoGenerated ?? false,
          protected: skill.protected ?? false,
          promoted: false,
        },
      })
    }
  }

  // ── APO ──────────────────────────────────────────────────────────────────────

  async getActiveVariants(slot: ApoSlot): Promise<ApoVariant[]> {
    const variants = await prisma.apoVariant.findMany({
      where: { slot, active: true },
      orderBy: { score: 'desc' },
    })
    return variants as ApoVariant[]
  }

  async updateVariantScore(id: string, score: number): Promise<void> {
    await prisma.apoVariant.update({
      where: { id },
      data: {
        score,
        trials: { increment: 1 },
      },
    })
  }

  async seedVariant(name: string, slot: ApoSlot, content: string): Promise<ApoVariant> {
    const variant = await prisma.apoVariant.upsert({
      where: { name_slot: { name, slot } },
      update: {},  // never overwrite active variants
      create: { name, slot, content, score: 0.0, trials: 0, active: true },
    })
    return variant as ApoVariant
  }

  async createSkillProposal(
    skillName: string,
    characterId: string,
    oldBody: string,
    newBody: string,
    reason: string,
    autoAcceptAt: Date
  ): Promise<SkillProposal> {
    const proposal = await prisma.skillProposal.create({
      data: { skillName, characterId, oldBody, newBody, reason, autoAcceptAt },
    })
    return proposal as SkillProposal
  }

  async getSkillProposals(characterId: string): Promise<SkillProposal[]> {
    const proposals = await prisma.skillProposal.findMany({
      where: { characterId, accepted: null },
      orderBy: { createdAt: 'desc' },
    })
    return proposals as SkillProposal[]
  }

  async resolveSkillProposal(id: string, accepted: boolean): Promise<void> {
    await prisma.skillProposal.update({
      where: { id },
      data: { accepted },
    })
  }

  async processExpiredProposals(): Promise<void> {
    await prisma.skillProposal.updateMany({
      where: {
        accepted: null,
        autoAcceptAt: { lte: new Date() },
      },
      data: { accepted: true },
    })
  }

  // ── Conversation Summaries ───────────────────────────────────────────────────

  async addConversationSummary(
    sessionId: string,
    characterId: string,
    summary: string,
    turnStart: number,
    turnEnd: number
  ): Promise<ConversationSummaryRecord> {
    const record = await prisma.conversationSummary.create({
      data: { sessionId, characterId, summary, turnStart, turnEnd },
    })
    return record as ConversationSummaryRecord
  }

  async getConversationSummaries(
    sessionId: string,
    characterId?: string
  ): Promise<ConversationSummaryRecord[]> {
    const where = characterId
      ? { sessionId, characterId }
      : { sessionId }
    const records = await prisma.conversationSummary.findMany({
      where,
      orderBy: { turnStart: 'asc' },
    })
    return records as ConversationSummaryRecord[]
  }

  // ── Character Config ─────────────────────────────────────────────────────────

  async getCharacterConfig(name: string): Promise<CharacterConfig | null> {
    const config = await prisma.characterConfig.findUnique({ where: { name } })
    return config as CharacterConfig | null
  }

  async upsertCharacterConfig(name: string, provider: string, llmModel: string | null): Promise<void> {
    const { personalities } = await import('./personalities')
    const p = personalities[name]
    await prisma.characterConfig.upsert({
      where: { name },
      create: {
        name,
        basePrompt:  p?.basePrompt          ?? '',
        avatarModel: p?.model               ?? '/Aimee.glb',
        voiceLocal:  p?.voiceLocal          ?? 'Aimee.mp3',
        voiceCloud:  p?.voiceCloud          ?? null,
        description: p?.defaultDescription  ?? '',
        provider:    provider as CharacterConfig['provider'],
        llmModel:    llmModel ?? null,
      },
      update: {
        provider: provider as CharacterConfig['provider'],
        llmModel: llmModel ?? null,
      },
    })
  }

  // ── Factory Reset ────────────────────────────────────────────────────────────

  async resetCharacterMemory(characterId: string): Promise<void> {
    await prisma.topic.deleteMany({ where: { characterId } })
  }

  async resetLearnedBehaviors(): Promise<void> {
    await prisma.$transaction([
      prisma.skillStat.deleteMany({}),
      prisma.apoVariant.deleteMany({}),
      prisma.skillProposal.deleteMany({}),
    ])
  }

  async factoryReset(): Promise<void> {
    await prisma.$transaction([
      prisma.skillStat.deleteMany({}),
      prisma.apoVariant.deleteMany({}),
      prisma.skillProposal.deleteMany({}),
      prisma.conversationSummary.deleteMany({}),
      prisma.span.deleteMany({}),
      prisma.topic.deleteMany({}),
    ])
  }

  // ── Eviction ─────────────────────────────────────────────────────────────────

  async getStorageStats(): Promise<StorageStats> {
    const [topics, sessions, messages, spans, skills, summaries] = await Promise.all([
      prisma.topic.count(),
      prisma.session.count(),
      prisma.message.count(),
      prisma.span.count(),
      prisma.skillStat.count(),
      prisma.conversationSummary.count(),
    ])
    return { topics, sessions, messages, spans, skills, summaries }
  }

  async runEviction(opts: EvictionOptions = {}): Promise<EvictionResult> {
    const maxSpanAgeDays    = opts.maxSpanAgeDays    ?? 30
    const maxSessionCount   = opts.maxSessionCount   ?? 100
    const maxSummaryAgeDays = opts.maxSummaryAgeDays ?? 90

    const spanCutoff    = new Date(Date.now() - maxSpanAgeDays    * 86_400_000)
    const summaryCutoff = new Date(Date.now() - maxSummaryAgeDays * 86_400_000)

    const [{ count: spansDeleted }, { count: summariesDeleted }] = await Promise.all([
      prisma.span.deleteMany({ where: { createdAt: { lt: spanCutoff } } }),
      prisma.conversationSummary.deleteMany({ where: { createdAt: { lt: summaryCutoff } } }),
    ])

    let sessionsDeleted = 0
    const sessionCount = await prisma.session.count()
    if (sessionCount > maxSessionCount) {
      const keep = await prisma.session.findMany({
        orderBy: { createdAt: 'desc' },
        take: maxSessionCount,
        select: { id: true },
      })
      const keepIds = keep.map(s => s.id)
      const { count } = await prisma.session.deleteMany({
        where: { id: { notIn: keepIds } },
      })
      sessionsDeleted = count
    }

    return { spansDeleted, sessionsDeleted, summariesDeleted }
  }

  // ── Migrations ───────────────────────────────────────────────────────────────
  // Prisma handles migrations via `prisma migrate dev` / `prisma migrate deploy`.
  // These methods exist to satisfy the interface; SqliteMemoryStore implements them fully.

  async getCurrentVersion(): Promise<number> {
    // Prisma tracks migrations in _prisma_migrations. Return count as version proxy.
    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `
    return Number(result[0]?.count ?? 0)
  }

  async runPendingMigrations(): Promise<void> {
    // Prisma migrations are run via CLI (prisma migrate deploy), not programmatically.
    // This is a no-op for the Prisma implementation.
  }
}
