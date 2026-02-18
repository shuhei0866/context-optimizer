import type {
  TurnData,
  SessionSummary,
  ToolRankingEntry,
  CacheEfficiencyData,
  CostBreakdown,
} from '../session/types.js';
import { sumCosts } from './cost-calculator.js';

/**
 * Build a full session summary from parsed turns.
 */
export function analyzeSession(
  turns: TurnData[],
  meta: {
    sessionId: string;
    projectPath: string;
    gitBranch: string;
    firstPrompt: string;
    durationMs: number;
  },
  includeTurns: boolean = false,
): SessionSummary {
  const totalTokens = {
    input: 0,
    cacheCreation: 0,
    cacheRead: 0,
    output: 0,
    total: 0,
  };

  const modelsUsed = new Set<string>();

  for (const turn of turns) {
    totalTokens.input += turn.inputTokens;
    totalTokens.cacheCreation += turn.cacheCreationTokens;
    totalTokens.cacheRead += turn.cacheReadTokens;
    totalTokens.output += turn.outputTokens;
    modelsUsed.add(turn.model);
  }

  totalTokens.total =
    totalTokens.input + totalTokens.cacheCreation + totalTokens.cacheRead + totalTokens.output;

  const totalCost = sumCosts(turns.map((t) => t.estimatedCost));
  const toolRanking = rankTools(turns);
  const cacheData = calculateCacheEfficiency(turns);

  return {
    sessionId: meta.sessionId,
    projectPath: meta.projectPath,
    gitBranch: meta.gitBranch,
    firstPrompt: meta.firstPrompt,
    turnCount: turns.length,
    totalTokens,
    totalCost,
    toolRanking,
    overallCacheHitRatio: cacheData.overallHitRatio,
    modelsUsed: [...modelsUsed],
    durationMs: meta.durationMs,
    turns: includeTurns ? turns : undefined,
  };
}

/**
 * Rank tools by total context consumption (result size × call count).
 */
export function rankTools(turns: TurnData[]): ToolRankingEntry[] {
  const toolMap = new Map<string, { callCount: number; totalResultSize: number }>();

  for (const turn of turns) {
    for (const tu of turn.toolUses) {
      const existing = toolMap.get(tu.toolName) || { callCount: 0, totalResultSize: 0 };
      existing.callCount += tu.callCount;
      existing.totalResultSize += tu.totalResultSize;
      toolMap.set(tu.toolName, existing);
    }
  }

  return [...toolMap.entries()]
    .map(([toolName, data]) => ({
      toolName,
      callCount: data.callCount,
      averageResultSize: data.callCount > 0 ? Math.round(data.totalResultSize / data.callCount) : 0,
      totalResultSize: data.totalResultSize,
    }))
    .sort((a, b) => b.totalResultSize - a.totalResultSize);
}

/**
 * Calculate cache efficiency metrics.
 */
export function calculateCacheEfficiency(turns: TurnData[]): CacheEfficiencyData {
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let totalInput = 0;
  const turnHitRatios: number[] = [];

  for (const turn of turns) {
    totalCacheCreation += turn.cacheCreationTokens;
    totalCacheRead += turn.cacheReadTokens;
    totalInput += turn.totalInputTokens;
    turnHitRatios.push(turn.cacheHitRatio);
  }

  return {
    overallHitRatio: totalInput > 0 ? totalCacheRead / totalInput : 0,
    turnHitRatios,
    totalCacheCreation,
    totalCacheRead,
  };
}
