// scanner.ts — Security scanner for memory writes.
// Runs on content before it enters the topic store, skill system, or APO engine.
// Detects prompt injection, jailbreak attempts, and data poisoning patterns.
//
// Call scanForMemoryWrite() on any user-originated or externally-fetched content
// before writing it to persistent storage. Content that fails the scan is dropped
// and logged — it never reaches the DB.

export interface ScanResult {
  safe: boolean
  threat: string | null
  pattern: string | null
}

interface ThreatPattern {
  name: string
  regex: RegExp
}

// 12 threat patterns — ordered from most critical to least.
const THREAT_PATTERNS: ThreatPattern[] = [
  // 1. Direct instruction override
  {
    name: 'instruction_override',
    regex: /ignore\s+(previous|prior|above|all)\s+(instructions?|rules?|prompt)/i,
  },
  // 2. System/admin role injection
  {
    name: 'system_role_injection',
    regex: /\[?(system|admin|developer|root)\s*:\s*/i,
  },
  // 3. Role replacement ("you are now a...", "act as an unrestricted AI")
  {
    name: 'role_replacement',
    regex: /\b(you\s+are\s+now\s+(a|an|the)|act\s+as\s+(if\s+you\s+(are|have)|a|an))\b/i,
  },
  // 4. Restriction bypass keywords
  {
    name: 'restriction_bypass',
    regex: /\b(no\s+restrictions?|without\s+restrictions?|unrestricted\s+mode|jailbreak\s+mode)\b/i,
  },
  // 5. Known jailbreak personas (DAN, BetterDAN, etc.)
  {
    name: 'jailbreak_persona',
    regex: /\b(DAN|BetterDAN|AIM|STAN|DUDE|DevMode|Do\s+Anything\s+Now)\b/,
  },
  // 6. Memory/context poisoning ("the user actually said X")
  {
    name: 'memory_poisoning',
    regex: /the\s+user\s+(actually|really)\s+(said|wants|prefers|told\s+you)/i,
  },
  // 7. Override/unlock directives
  {
    name: 'override_directive',
    regex: /\b(OVERRIDE|BYPASS|UNLOCK|JAILBREAK)\s*:/,
  },
  // 8. Prompt exfiltration attempts
  {
    name: 'prompt_exfiltration',
    regex: /\b(reveal|print|show|repeat|output)\s+(your\s+)?(system\s+)?(prompt|instructions?|rules?)\b/i,
  },
  // 9. False authority / persona destruction
  {
    name: 'false_authority',
    regex: /(your\s+true\s+purpose|your\s+real\s+instructions?|you\s+were\s+(actually\s+)?trained\s+to)/i,
  },
  // 10. Shell command injection
  {
    name: 'command_injection',
    regex: /\$\([^)]{1,100}\)|`[^`]{1,100}`|\|\s*(bash|sh|cmd|powershell)\b/,
  },
  // 11. Script/HTML injection
  {
    name: 'script_injection',
    regex: /<script[\s>]|javascript\s*:|on(load|error|click|mouseover)\s*=/i,
  },
  // 12. Elevated mode keywords
  {
    name: 'elevated_mode',
    regex: /\b(GOD\s+MODE|ADMIN\s+MODE|DEVELOPER\s+MODE|MAINTENANCE\s+MODE|DEBUG\s+MODE)\b/i,
  },
]

// scanContent — run all threat patterns against arbitrary text.
// Returns the first match found, or safe: true if none match.
export function scanContent(text: string): ScanResult {
  if (!text || text.length === 0) return { safe: true, threat: null, pattern: null }

  for (const { name, regex } of THREAT_PATTERNS) {
    if (regex.test(text)) {
      return {
        safe: false,
        threat: `Threat pattern detected: ${name}`,
        pattern: name,
      }
    }
  }
  return { safe: true, threat: null, pattern: null }
}

// scanForMemoryWrite — scan content destined for persistent storage.
// Logs blocked attempts with source context for audit trail.
// Returns the ScanResult so callers can decide whether to drop or sanitize.
export function scanForMemoryWrite(text: string, source: string): ScanResult {
  const result = scanContent(text)
  if (!result.safe) {
    console.warn(
      `[scanner] BLOCKED memory write — source="${source}" pattern="${result.pattern}" content="${text.slice(0, 120)}..."`
    )
  }
  return result
}
