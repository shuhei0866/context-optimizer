import type { CostBreakdown } from '../session/types.js';

interface ModelPricing {
  input: number; // USD per million tokens
  output: number;
  cache5mWrite: number;
  cache1hWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    input: 5,
    output: 25,
    cache5mWrite: 6.25,
    cache1hWrite: 10,
    cacheRead: 0.5,
  },
  'claude-sonnet-4-5': {
    input: 3,
    output: 15,
    cache5mWrite: 3.75,
    cache1hWrite: 6,
    cacheRead: 0.3,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cache5mWrite: 1.25,
    cache1hWrite: 2,
    cacheRead: 0.1,
  },
};

function resolveModel(model: string): ModelPricing {
  // Exact match first
  if (PRICING[model]) return PRICING[model];

  // Prefix match (e.g., "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5")
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key)) return pricing;
  }

  // Default to opus pricing (most conservative estimate)
  return PRICING['claude-opus-4-6'];
}

/**
 * Calculate cost for a single API call.
 *
 * Note: Claude Code primarily uses 1h ephemeral cache for system prompts.
 * We use cache1hWrite as the default cache write pricing since we can't
 * distinguish 5m vs 1h cache from the aggregated usage data reliably.
 */
export function calculateTurnCost(
  model: string,
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  },
): CostBreakdown {
  const pricing = resolveModel(model);
  const perM = 1_000_000;

  const input = (usage.input_tokens / perM) * pricing.input;
  const cacheCreation = (usage.cache_creation_input_tokens / perM) * pricing.cache1hWrite;
  const cacheRead = (usage.cache_read_input_tokens / perM) * pricing.cacheRead;
  const output = (usage.output_tokens / perM) * pricing.output;

  return {
    input,
    cacheCreation,
    cacheRead,
    output,
    total: input + cacheCreation + cacheRead + output,
  };
}

export function sumCosts(costs: CostBreakdown[]): CostBreakdown {
  const result: CostBreakdown = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 };
  for (const c of costs) {
    result.input += c.input;
    result.cacheCreation += c.cacheCreation;
    result.cacheRead += c.cacheRead;
    result.output += c.output;
    result.total += c.total;
  }
  return result;
}
