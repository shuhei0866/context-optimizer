import type { SessionSummary } from '../session/types.js';

export interface DailyTrend {
  date: string; // YYYY-MM-DD
  sessionCount: number;
  totalTokens: number;
  totalCost: number;
  averageCacheHitRatio: number;
}

/**
 * Calculate daily trends from session summaries.
 */
export function calculateDailyTrends(summaries: SessionSummary[]): DailyTrend[] {
  const byDate = new Map<string, SessionSummary[]>();

  for (const s of summaries) {
    // Extract date from first turn's timestamp, or sessionId-based timestamp
    const date = extractDate(s);
    if (!date) continue;
    const list = byDate.get(date) || [];
    list.push(s);
    byDate.set(date, list);
  }

  const trends: DailyTrend[] = [];
  for (const [date, sessions] of byDate) {
    trends.push({
      date,
      sessionCount: sessions.length,
      totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens.total, 0),
      totalCost: sessions.reduce((sum, s) => sum + s.totalCost.total, 0),
      averageCacheHitRatio:
        sessions.reduce((sum, s) => sum + s.overallCacheHitRatio, 0) / sessions.length,
    });
  }

  return trends.sort((a, b) => a.date.localeCompare(b.date));
}

function extractDate(summary: SessionSummary): string | null {
  // Try to get date from turns
  if (summary.turns && summary.turns.length > 0) {
    return summary.turns[0].timestamp.slice(0, 10);
  }
  return null;
}
