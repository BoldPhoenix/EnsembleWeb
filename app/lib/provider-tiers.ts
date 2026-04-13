/**
 * Provider tier classification for anti-sycophancy Layer 2.
 *
 * Empirical sycophancy rankings based on observed behavior of major LLM providers.
 * Used by the settings UI to warn users when they select a high-sycophancy model
 * for a character where rigor matters.
 *
 * Rankings are heuristic and apply to DEFAULT models from each provider. Individual
 * fine-tunes can deviate significantly in either direction. This is a starting
 * point, not a contract.
 *
 * See docs/ANTI_SYCOPHANCY_PLAN.md for the full 8-layer defense architecture.
 */

export type SycophancyTier = 'low' | 'moderate' | 'high' | 'unknown'

export interface ProviderTierInfo {
  provider: string
  tier: SycophancyTier
  notes: string
}

/**
 * Provider-level sycophancy ratings. Overridable per-model via MODEL_TIER_OVERRIDES.
 */
const PROVIDER_TIERS: Record<string, ProviderTierInfo> = {
  anthropic: {
    provider: 'anthropic',
    tier: 'low',
    notes: 'Claude models are RLHF-trained against sycophancy. Most resistant to flattery pressure.',
  },
  openrouter: {
    provider: 'openrouter',
    tier: 'moderate',
    notes: 'Behavior depends entirely on which specific model is selected on OpenRouter. See model-level overrides.',
  },
  gemini: {
    provider: 'gemini',
    tier: 'moderate',
    notes: 'Gemini 2.5+ can be prompted away from sycophancy but is more agreeable by default than Claude.',
  },
  ollama: {
    provider: 'ollama',
    tier: 'moderate',
    notes: 'Depends entirely on the local model selected. Qwen and DeepSeek are low; Llama variants tend high.',
  },
  openai: {
    provider: 'openai',
    tier: 'moderate',
    notes: 'GPT-4o is prone to validation without heavy prompting. Works but not preferred for rigor-sensitive characters.',
  },
  custom: {
    provider: 'custom',
    tier: 'unknown',
    notes: 'Custom endpoints cannot be classified without knowing the underlying model.',
  },
}

/**
 * Model-name overrides. Takes precedence over provider-level tier when the model
 * name (case-insensitive substring) matches. Allows us to correctly classify
 * Claude-through-OpenRouter as "low" even though OpenRouter itself is "moderate".
 */
const MODEL_TIER_OVERRIDES: Array<{ pattern: RegExp; tier: SycophancyTier; notes: string }> = [
  // Low sycophancy — actively trained against it or empirically direct
  { pattern: /claude/i, tier: 'low', notes: 'Claude family — RLHF-trained against sycophancy.' },
  { pattern: /deepseek/i, tier: 'low', notes: 'DeepSeek family — empirically direct and willing to disagree.' },
  { pattern: /qwen/i, tier: 'low', notes: 'Qwen family — less user-pleasing training bias.' },

  // High sycophancy — known to over-validate
  { pattern: /llama-?3/i, tier: 'high', notes: 'Llama 3 family is notably sycophantic. Consider a different model for conversational characters.' },
  { pattern: /llama-?2/i, tier: 'high', notes: 'Older Llama derivatives tend toward agreement.' },

  // Reasoning models — generally lower sycophancy due to thinking traces exposing their actual reasoning
  { pattern: /reasoning|thinking|r1-|-r1/i, tier: 'low', notes: 'Reasoning-trained models expose their thinking, making sycophancy harder to hide.' },
]

/**
 * Classify a (provider, model) pair's sycophancy tier.
 * Model-level overrides win when they match. Otherwise falls back to provider default.
 */
export function classifyTier(provider: string, model: string | null | undefined): ProviderTierInfo {
  const providerKey = provider.toLowerCase()
  const modelName = (model || '').trim()

  // Check model-level overrides first
  if (modelName) {
    for (const override of MODEL_TIER_OVERRIDES) {
      if (override.pattern.test(modelName)) {
        return {
          provider: providerKey,
          tier: override.tier,
          notes: override.notes,
        }
      }
    }
  }

  // Fall through to provider default
  return PROVIDER_TIERS[providerKey] ?? {
    provider: providerKey,
    tier: 'unknown',
    notes: `Unknown provider "${providerKey}". Sycophancy behavior cannot be predicted.`,
  }
}

/**
 * Human-readable warning text for a tier. Used by the settings UI.
 * Returns null for low/unknown tiers (nothing to warn about).
 */
export function tierWarning(info: ProviderTierInfo): string | null {
  switch (info.tier) {
    case 'high':
      return `⚠ This model has a higher tendency to validate rather than push back. ${info.notes} For conversational characters where honesty matters, consider a different model.`
    case 'moderate':
      return `This model's honesty depends on prompt engineering. Ensemble's anti-sycophancy directives will help, but a lower-sycophancy model (Claude, Qwen, DeepSeek) is preferable for characters where rigor matters.`
    case 'low':
      return null
    case 'unknown':
      return null
    default:
      return null
  }
}

/**
 * Given no explicit character config, what provider+model should we default to?
 * Returns the highest-confidence low-sycophancy default based on what API keys
 * are available in the environment.
 */
export function defaultAntiSycophancyProvider(env: {
  ANTHROPIC_API_KEY?: string
  OPENROUTER_API_KEY?: string
  GEMINI_API_KEY?: string
  OLLAMA_URL?: string
}): { provider: string; model: string; reason: string } {
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      reason: 'Anthropic API key available — Claude is the most sycophancy-resistant default.',
    }
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4-6',
      reason: 'OpenRouter available — routing to Claude via OpenRouter for low sycophancy.',
    }
  }
  if (env.OLLAMA_URL) {
    return {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      reason: 'Local Ollama available — Qwen 2.5 is a low-sycophancy local default.',
    }
  }
  if (env.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      reason: 'Only Gemini available — acceptable with anti-sycophancy directives, but Claude or Qwen preferred if possible.',
    }
  }
  return {
    provider: 'ollama',
    model: 'qwen2.5:7b',
    reason: 'No providers configured. Defaulting to Ollama/Qwen assuming user will configure.',
  }
}
