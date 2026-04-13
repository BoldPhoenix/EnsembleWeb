// Snapshot — frozen long-term memory for a session.
//
// The first request of a session builds the character's topic summary and freezes it.
// Subsequent requests in the same session reuse the frozen string, preventing:
//   1. Mid-session drift (topics added during the session affecting the prompt prefix)
//   2. Redundant DB reads on every request (one read at session start, then cached)
//
// This is an in-process cache (survives across requests within the same Node.js process
// but resets on cold start). That's acceptable — cold starts just rebuild from DB.
// A full DB-persisted snapshot can be added later if cold-start frequency matters.

import { getAllTopicsSummary } from './memory'

// Map from sessionId → frozen topic summary string
const snapshotCache = new Map<string, string>()

/**
 * Get the frozen long-term memory snapshot for a session.
 * Builds and caches on first call; returns cached value on subsequent calls.
 * Returns empty string if no topics exist yet.
 */
export async function getSessionSnapshot(
  sessionId: string,
  characterId?: string
): Promise<string> {
  if (snapshotCache.has(sessionId)) {
    return snapshotCache.get(sessionId)!
  }

  const snapshot = await getAllTopicsSummary(characterId)
  snapshotCache.set(sessionId, snapshot)
  return snapshot
}

/**
 * Invalidate a session's snapshot. Call when a factory reset wipes topics,
 * or at explicit session end if desired. Next request will rebuild from DB.
 */
export function invalidateSnapshot(sessionId: string): void {
  snapshotCache.delete(sessionId)
}

/**
 * Invalidate all snapshots for a character. Used after resetCharacterMemory().
 * Since we don't track which sessions belong to which character in the cache,
 * this clears everything — acceptable given cold-start rebuild cost is low.
 */
export function invalidateAllSnapshots(): void {
  snapshotCache.clear()
}
