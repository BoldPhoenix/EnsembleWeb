// MemoryStore — storage-agnostic interface for all intelligence-layer persistence.
//
// Implementations:
//   PrismaMemoryStore  — PostgreSQL via Prisma (Ensemble Web / Vercel)
//   SqliteMemoryStore  — SQLite via better-sqlite3 (Ensemble Desktop, future)
//
// The intelligence layer (compressor, skills, APO, tracer) only ever sees this
// interface. Never call Prisma directly from intelligence-layer code.

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

export interface MemoryStore {

  // ── Topics ──────────────────────────────────────────────────────────────────
  // characterId = null means shared knowledge (visible to all characters)

  upsertTopic(
    name: string,
    label: string,
    category: string,
    summary: string,
    characterId?: string | null
  ): Promise<Topic>

  linkTopicToMessage(topicId: string, messageId: string): Promise<void>

  findTopicByName(name: string): Promise<Topic | null>

  findTopicsByKeywords(keywords: string[]): Promise<Topic[]>

  findTopicsByCharacter(characterId: string, limit: number): Promise<Topic[]>

  getAllTopics(limit: number): Promise<Topic[]>

  // ── Sessions ─────────────────────────────────────────────────────────────────

  createSession(title: string): Promise<Session>

  getRecentSessions(limit: number): Promise<SessionSummary[]>

  // ── Messages ─────────────────────────────────────────────────────────────────

  addMessage(
    sessionId: string,
    role: string,
    content: string,
    personality: string
  ): Promise<Message>

  getSessionMessages(sessionId: string): Promise<Message[]>

  // ── Spans (tracer) ───────────────────────────────────────────────────────────
  // Spans are the observability primitive. All scoring operates on spans.
  // recordSpan is cheap — call it for every LLM call, tool use, and memory op.

  recordSpan(span: SpanInput): Promise<void>

  querySpans(sessionId: string): Promise<Span[]>

  // Walk spans for the given session and update skill scores atomically.
  // Called at the start of the NEXT session (lazy eval), not at session close.
  processSkillFires(sessionId: string): Promise<void>

  // Find sessions older than ageMs with unprocessed skill spans and process them.
  // Handles churned users who never return to trigger processSkillFires normally.
  // Recommended threshold: 24 hours (86_400_000 ms).
  processStaleSessionFires(ageMs: number): Promise<void>

  // ── Skills ───────────────────────────────────────────────────────────────────

  getSkillStats(characterId?: string): Promise<SkillStat[]>

  updateSkillScore(
    skillName: string,
    score: number,
    decay: number,
    characterId?: string
  ): Promise<void>

  promoteSkill(skillName: string): Promise<void>

  pruneSkill(skillName: string): Promise<void>

  // Seed initial skills for a character. Safe to call multiple times — skips
  // skills that already exist by name+characterId.
  seedSkills(characterId: string, skills: SeedSkill[]): Promise<void>

  // ── APO ──────────────────────────────────────────────────────────────────────

  getActiveVariants(slot: ApoSlot): Promise<ApoVariant[]>

  updateVariantScore(id: string, score: number): Promise<void>

  seedVariant(name: string, slot: ApoSlot, content: string): Promise<ApoVariant>

  // Skill proposals are APO-generated diffs surfaced to the user in settings.
  // Users accept/reject. Auto-accept after 7 days if no action taken.
  createSkillProposal(
    skillName: string,
    characterId: string,
    oldBody: string,
    newBody: string,
    reason: string,
    autoAcceptAt: Date
  ): Promise<SkillProposal>

  getSkillProposals(characterId: string): Promise<SkillProposal[]>

  resolveSkillProposal(id: string, accepted: boolean): Promise<void>

  processExpiredProposals(): Promise<void>

  // ── Conversation Summaries ───────────────────────────────────────────────────

  addConversationSummary(
    sessionId: string,
    characterId: string,
    summary: string,
    turnStart: number,
    turnEnd: number
  ): Promise<ConversationSummaryRecord>

  getConversationSummaries(
    sessionId: string,
    characterId?: string
  ): Promise<ConversationSummaryRecord[]>

  // ── Character Config ─────────────────────────────────────────────────────────
  // Returns null when no row exists — callers should fall back to global chain.

  getCharacterConfig(name: string): Promise<CharacterConfig | null>

  // Upsert provider/model override for a character. Required fields are seeded
  // from personalities.ts on first create so the row is always valid.
  upsertCharacterConfig(name: string, provider: string, llmModel: string | null): Promise<void>

  // ── Factory Reset ────────────────────────────────────────────────────────────

  // Wipe topics attributed to characterId. Shared (null) topics are untouched.
  resetCharacterMemory(characterId: string): Promise<void>

  // Wipe SkillStat, ApoVariant, SkillProposal rows. Reload defaults next init.
  resetLearnedBehaviors(): Promise<void>

  // Both of the above, plus ConversationSummary. Full clean slate.
  factoryReset(): Promise<void>

  // ── Eviction ─────────────────────────────────────────────────────────────────
  // Keeps the database from growing unbounded. Safe to call at any time.

  // Current row counts across all intelligence-layer tables.
  getStorageStats(): Promise<StorageStats>

  // Prune old spans, excess sessions, and stale summaries.
  // Uses sensible defaults if opts is omitted.
  runEviction(opts?: EvictionOptions): Promise<EvictionResult>

  // ── Migrations ───────────────────────────────────────────────────────────────
  // PrismaMemoryStore delegates to Prisma Migrate.
  // SqliteMemoryStore runs numbered SQL scripts against a schema_version table.

  getCurrentVersion(): Promise<number>

  runPendingMigrations(): Promise<void>
}

// ── Singleton accessor ────────────────────────────────────────────────────────
// Returns the active MemoryStore. Import this instead of instantiating directly.

import { PrismaMemoryStore } from './memory-store-prisma'

const globalForStore = globalThis as unknown as { memoryStore: MemoryStore }

export function getMemoryStore(): MemoryStore {
  if (!globalForStore.memoryStore) {
    globalForStore.memoryStore = new PrismaMemoryStore()
  }
  return globalForStore.memoryStore
}
