// All storage operations go through getMemoryStore(). Never call Prisma here.
import { getMemoryStore } from './memory-store'

// Stop words to ignore during topic extraction
const STOP_WORDS = new Set([
  "i", "me", "my", "myself", "we", "our", "ours", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them",
  "their", "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "having", "do", "does", "did", "doing", "a", "an", "the", "and",
  "but", "if", "or", "because", "as", "until", "while", "of", "at", "by",
  "for", "with", "about", "against", "between", "through", "during", "before",
  "after", "above", "below", "to", "from", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "can", "will", "just", "don", "should", "now",
  "also", "like", "well", "right", "know", "think", "want", "need", "make",
  "got", "get", "go", "going", "would", "could", "shall", "may", "might",
  "let", "say", "said", "tell", "told", "ask", "asked", "look", "see",
  "come", "take", "give", "good", "new", "first", "last", "long", "great",
  "little", "own", "old", "big", "high", "different", "small", "large",
  "next", "early", "young", "important", "public", "bad", "sure", "yes",
  "yeah", "okay", "ok", "hey", "hi", "hello", "thanks", "thank", "please",
  "sorry", "oh", "ah", "um", "uh", "wow", "haha", "lol", "hmm",
  // AI-specific stop words
  "ai", "model", "response", "question", "answer", "help", "thing", "things",
  "something", "anything", "everything", "nothing", "way", "bit", "lot",
  "much", "many", "still", "really", "actually", "probably", "maybe",
  "definitely", "absolutely", "certainly", "basically", "simply",
  // Character names handled separately
  "aimee", "arthur",
])

/**
 * Extract proper nouns and significant terms from text.
 * Returns lowercase unique terms.
 */
export function extractKeyTerms(text: string): string[] {
  const terms = new Set<string>()

  // Find capitalized words (proper nouns) — 2+ chars, not at sentence start
  const sentences = text.split(/[.!?]\s+/)
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/)
    for (let i = 1; i < words.length; i++) {
      const word = words[i].replace(/[^a-zA-Z0-9-]/g, "")
      if (word.length >= 2 && /^[A-Z]/.test(word) && !STOP_WORDS.has(word.toLowerCase())) {
        terms.add(word.toLowerCase())
      }
    }
    // Also check first word if it looks like a name (not common sentence starters)
    if (words.length > 0) {
      const first = words[0].replace(/[^a-zA-Z0-9-]/g, "")
      if (first.length >= 2 && /^[A-Z]/.test(first) && !STOP_WORDS.has(first.toLowerCase())) {
        terms.add(first.toLowerCase())
      }
    }
  }

  // Find quoted terms
  const quoted = text.match(/"([^"]+)"/g)
  if (quoted) {
    for (const q of quoted) {
      const clean = q.replace(/"/g, "").trim().toLowerCase()
      if (clean.length >= 2 && clean.length <= 50) {
        terms.add(clean)
      }
    }
  }

  return Array.from(terms)
}

/**
 * Extract topics from a conversation turn and upsert them into the store.
 * characterId = null stores as shared knowledge (visible to all characters).
 */
export async function extractAndStoreTopics(
  userMessage: string,
  assistantMessage: string,
  messageId: string,
  characterId?: string | null
) {
  const combined = `${userMessage} ${assistantMessage}`
  const terms = extractKeyTerms(combined)

  if (terms.length === 0) return

  const store = getMemoryStore()

  for (const term of terms) {
    // Build context snippet — sentences that mention this term
    const sentences = combined.split(/[.!?]\s+/)
    const relevant = sentences
      .filter(s => s.toLowerCase().includes(term))
      .map(s => s.trim())
      .slice(0, 3)

    if (relevant.length === 0) continue

    const snippet = relevant.join(". ").slice(0, 500)
    const category = categorize(term, snippet)

    try {
      const topic = await store.upsertTopic(
        term,
        term.charAt(0).toUpperCase() + term.slice(1),
        category,
        snippet,
        characterId ?? null
      )
      await store.linkTopicToMessage(topic.id, messageId)
    } catch (e) {
      // Topic extraction is best-effort — don't crash the chat
      console.error("Topic extraction error:", e)
    }
  }
}

/**
 * Categorize a topic based on context clues.
 */
function categorize(term: string, context: string): string {
  const lower = context.toLowerCase()

  if (lower.includes("character") || lower.includes("avatar") || lower.includes("robot") || lower.includes("personality")) {
    return "character"
  }
  if (lower.includes("image") || lower.includes("picture") || lower.includes("photo") || lower.includes("render")) {
    return "image"
  }
  if (lower.includes("project") || lower.includes("app") || lower.includes("build") || lower.includes("code")) {
    return "project"
  }
  if (lower.includes("person") || lower.includes("friend") || lower.includes("family") || lower.includes("developer")) {
    return "person"
  }
  return "concept"
}

/**
 * Get a compact summary of topics for the system prompt.
 * When characterId is provided, returns topics for that character + shared topics (null characterId).
 * When omitted, returns all topics (legacy behavior, used when characterId is unknown).
 */
export async function getAllTopicsSummary(characterId?: string): Promise<string> {
  const store = getMemoryStore()
  const topics = characterId
    ? await store.findTopicsByCharacter(characterId, 50)
    : await store.getAllTopics(50)

  if (topics.length === 0) return ""

  const lines = topics.map(t => {
    const firstSentence = t.summary.split(/[.!?\n]/).filter(s => s.trim())[0] || t.summary
    return `- ${t.label} [${t.category}]: ${firstSentence.trim().slice(0, 150)}`
  })

  return `Things you know about (from past conversations):\n${lines.join("\n")}`
}

/**
 * Detect whether a user message makes a claim or assertion.
 * Assertive messages benefit from adversarial context retrieval (Layer 4) — the model
 * receives both supporting topics and adjacent-category topics that may contain
 * competing information, preventing it from simply echoing the user's position.
 */
export function isAssertiveMessage(text: string): boolean {
  const lower = text.toLowerCase()
  const patterns = [
    /\bi think\b/, /\bi believe\b/, /\bi feel\b/, /\bi know\b/,
    /\bshould\b/, /\bmust\b/, /\balways\b/, /\bnever\b/,
    /\bis the best\b/, /\bis the worst\b/, /\bwould be better\b/,
    /\bis wrong\b/, /\bis right\b/, /\bis stupid\b/, /\bis great\b/,
    /\bfact is\b/, /\bthe truth is\b/, /\bobviously\b/, /\bclearly\b/,
    /\beveryone knows\b/, /\bit's obvious\b/, /\bit is obvious\b/,
  ]
  return patterns.some(p => p.test(lower))
}

/**
 * Look up specific topics by terms mentioned in the current message.
 * Uses 'both' mode for assertive messages (Layer 4: adversarial context).
 */
export async function lookupTopics(terms: string[], userMessage?: string): Promise<string> {
  if (terms.length === 0) return ""

  const store = getMemoryStore()
  const mode = (userMessage && isAssertiveMessage(userMessage)) ? 'both' : 'supporting'
  const topics = await store.findTopicsByKeywords(terms, mode)

  if (topics.length === 0) return ""

  const lines = topics.map(t => {
    return `- ${t.label} [${t.category}]: ${t.summary.slice(0, 500)}`
  })

  const header = mode === 'both'
    ? `What you know about these topics (including adjacent context for balance):`
    : `What you know about these topics (from your memory):`
  return `${header}\n${lines.join("\n")}`
}

/**
 * Get session summaries for the system prompt.
 */
export async function getSessionSummaries(): Promise<string> {
  const store = getMemoryStore()
  const sessions = await store.getRecentSessions(10)

  if (sessions.length === 0) return ""

  const lines = sessions.map(s => {
    const date = s.createdAt.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    })
    const previews = s.previewMessages.join(" | ")
    return `- Session ${date} (${s.messageCount} msgs): ${previews}`
  })

  return `Recent conversation history:\n${lines.join("\n")}`
}

/**
 * Build the full memory context to inject into the system prompt.
 * characterId scopes topic recall to that character + shared knowledge.
 */
export async function buildMemoryContext(userMessage: string, characterId?: string): Promise<string> {
  const terms = extractKeyTerms(userMessage)

  const [topicsSummary, relevantTopics, sessionSummaries] = await Promise.all([
    getAllTopicsSummary(characterId),
    lookupTopics(terms, userMessage),
    getSessionSummaries(),
  ])

  const parts = []
  if (topicsSummary) parts.push(topicsSummary)
  if (relevantTopics) parts.push(relevantTopics)
  if (sessionSummaries) parts.push(sessionSummaries)

  return parts.join("\n\n")
}
