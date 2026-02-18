import type { SessionSummary, CostBreakdown, ToolRankingEntry } from '../session/types.js';
import { sumCosts } from '../analyzer/cost-calculator.js';

export interface ProjectAggregation {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  totalTokens: number;
  averageTokens: number;
  totalCost: CostBreakdown;
  averageCost: number;
  averageCacheHitRatio: number;
}

export interface ToolAggregation {
  toolName: string;
  totalCalls: number;
  totalResultSize: number;
  averageResultSize: number;
}

export interface InsightsSummary {
  projects: ProjectAggregation[];
  topTools: ToolAggregation[];
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
}

/**
 * Aggregate session summaries into cross-project insights.
 */
export function aggregateInsights(summaries: SessionSummary[]): InsightsSummary {
  // Group by project
  const byProject = new Map<string, SessionSummary[]>();
  for (const s of summaries) {
    const key = s.projectPath || '不明';
    const list = byProject.get(key) || [];
    list.push(s);
    byProject.set(key, list);
  }

  const projects: ProjectAggregation[] = [];
  for (const [projectPath, sessions] of byProject) {
    const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens.total, 0);
    const totalCost = sumCosts(sessions.map((s) => s.totalCost));
    const avgCacheHit =
      sessions.reduce((sum, s) => sum + s.overallCacheHitRatio, 0) / sessions.length;

    projects.push({
      projectPath,
      projectName: projectPath.split('/').pop() || projectPath,
      sessionCount: sessions.length,
      totalTokens,
      averageTokens: Math.round(totalTokens / sessions.length),
      totalCost,
      averageCost: totalCost.total / sessions.length,
      averageCacheHitRatio: avgCacheHit,
    });
  }

  // Sort by total cost descending
  projects.sort((a, b) => b.totalCost.total - a.totalCost.total);

  // Aggregate tool usage across all sessions
  const toolMap = new Map<string, { totalCalls: number; totalResultSize: number }>();
  for (const s of summaries) {
    for (const t of s.toolRanking) {
      const existing = toolMap.get(t.toolName) || { totalCalls: 0, totalResultSize: 0 };
      existing.totalCalls += t.callCount;
      existing.totalResultSize += t.totalResultSize;
      toolMap.set(t.toolName, existing);
    }
  }

  const topTools: ToolAggregation[] = [...toolMap.entries()]
    .map(([toolName, data]) => ({
      toolName,
      totalCalls: data.totalCalls,
      totalResultSize: data.totalResultSize,
      averageResultSize: data.totalCalls > 0 ? Math.round(data.totalResultSize / data.totalCalls) : 0,
    }))
    .sort((a, b) => b.totalResultSize - a.totalResultSize);

  return {
    projects,
    topTools,
    totalSessions: summaries.length,
    totalTokens: summaries.reduce((sum, s) => sum + s.totalTokens.total, 0),
    totalCost: summaries.reduce((sum, s) => sum + s.totalCost.total, 0),
  };
}
