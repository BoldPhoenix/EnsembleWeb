import { prisma } from "./db"

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
 * Extract topics from a conversation turn and upsert them into the database.
 */
export async function extractAndStoreTopics(
  userMessage: string,
  assistantMessage: string,
  messageId: string
) {
  const combined = `${userMessage} ${assistantMessage}`
  const terms = extractKeyTerms(combined)

  if (terms.length === 0) return

  for (const term of terms) {
    // Build context snippet — sentences that mention this term
    const sentences = combined.split(/[.!?]\s+/)
    const relevant = sentences
      .filter(s => s.toLowerCase().includes(term))
      .map(s => s.trim())
      .slice(0, 3) // max 3 sentences per topic per turn

    if (relevant.length === 0) continue

    const snippet = relevant.join(". ").slice(0, 500)

    // Determine category based on context clues
    const category = categorize(term, snippet)

    try {
      // Upsert — create or append to existing topic
      const existing = await prisma.topic.findUnique({ where: { name: term } })

      if (existing) {
        // Append new context to existing summary
        const updatedSummary = existing.summary.length < 2000
          ? `${existing.summary}\n${snippet}`
          : existing.summary // don't grow forever

        await prisma.topic.update({
          where: { name: term },
          data: { summary: updatedSummary, category: category || existing.category },
        })

        // Link to message
        await prisma.topicMessage.create({
          data: { topicId: existing.id, messageId },
        }).catch(() => {}) // ignore if already linked
      } else {
        // Create new topic
        const topic = await prisma.topic.create({
          data: {
            name: term,
            label: term.charAt(0).toUpperCase() + term.slice(1),
            category,
            summary: snippet,
          },
        })

        await prisma.topicMessage.create({
          data: { topicId: topic.id, messageId },
        }).catch(() => {})
      }
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
 * Get a compact summary of ALL known topics for the system prompt.
 */
export async function getAllTopicsSummary(): Promise<string> {
  const topics = await prisma.topic.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50, // cap at 50 topics to avoid prompt overflow
  })

  if (topics.length === 0) return ""

  const lines = topics.map(t => {
    // Truncate summary to first sentence
    const firstSentence = t.summary.split(/[.!?\n]/).filter(s => s.trim())[0] || t.summary
    return `- ${t.label} [${t.category}]: ${firstSentence.trim().slice(0, 150)}`
  })

  return `Things you know about (from past conversations):\n${lines.join("\n")}`
}

/**
 * Look up specific topics by terms mentioned in the current message.
 */
export async function lookupTopics(terms: string[]): Promise<string> {
  if (terms.length === 0) return ""

  const topics = await prisma.topic.findMany({
    where: {
      name: { in: terms },
    },
  })

  if (topics.length === 0) return ""

  const lines = topics.map(t => {
    return `- ${t.label} [${t.category}]: ${t.summary.slice(0, 500)}`
  })

  return `What you know about these topics (from your memory):\n${lines.join("\n")}`
}

/**
 * Get session summaries for the system prompt.
 */
export async function getSessionSummaries(): Promise<string> {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      messages: {
        take: 6,
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        select: { content: true, createdAt: true },
      },
      _count: { select: { messages: true } },
    },
  })

  if (sessions.length === 0) return ""

  const lines = sessions.map(s => {
    const date = s.createdAt.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    })
    const previews = s.messages.map(m => m.content.slice(0, 60)).join(" | ")
    return `- Session ${date} (${s._count.messages} msgs): ${previews}`
  })

  return `Recent conversation history:\n${lines.join("\n")}`
}

/**
 * Build the full memory context to inject into the system prompt.
 */
export async function buildMemoryContext(userMessage: string): Promise<string> {
  const terms = extractKeyTerms(userMessage)

  const [topicsSummary, relevantTopics, sessionSummaries] = await Promise.all([
    getAllTopicsSummary(),
    lookupTopics(terms),
    getSessionSummaries(),
  ])

  const parts = []
  if (topicsSummary) parts.push(topicsSummary)
  if (relevantTopics) parts.push(relevantTopics)
  if (sessionSummaries) parts.push(sessionSummaries)

  return parts.join("\n\n")
}
