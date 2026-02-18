import { existsSync } from 'node:fs';
import { parseSession } from '../session/parser.js';
import { resolveSessionPaths, findProjects, findSessions } from '../session/reader.js';
import { analyzeSession } from '../analyzer/token-analyzer.js';
import { aggregateInsights, type InsightsSummary } from '../insights/aggregator.js';
import type { SessionSummary } from '../session/types.js';
import { formatNumber, formatUsd, formatPercent, padRight, padLeft } from '../utils/format.js';

interface InsightsOptions {
  project?: string;
  all: boolean;
  limit: number;
  format: 'text' | 'json';
}

function parseArgs(args: string[]): InsightsOptions {
  const options: InsightsOptions = {
    all: true,
    limit: 50,
    format: 'text',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
        options.project = args[++i];
        options.all = false;
        break;
      case '--all':
        options.all = true;
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10) || 50;
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'json';
        break;
    }
  }

  return options;
}

export async function runInsights(args: string[]): Promise<void> {
  const options = parseArgs(args);

  const resolved = resolveSessionPaths(options.project);

  if (resolved.length === 0) {
    console.error('セッションが見つかりません。');
    process.exit(1);
  }

  // Limit sessions to analyze
  const sessionsToAnalyze = resolved.slice(0, options.limit);

  console.error(`${sessionsToAnalyze.length} セッションを分析中...`);

  const summaries: SessionSummary[] = [];

  for (const { sessionPath, projectInfo, sessionEntry } of sessionsToAnalyze) {
    if (!existsSync(sessionPath)) continue;

    try {
      const parsed = await parseSession(sessionPath);
      if (parsed.turns.length === 0) continue;

      const summary = analyzeSession(
        parsed.turns,
        {
          sessionId: parsed.sessionId || sessionEntry.sessionId,
          projectPath: sessionEntry.projectPath || projectInfo.originalPath,
          gitBranch: parsed.gitBranch || sessionEntry.gitBranch,
          firstPrompt: parsed.firstPrompt || sessionEntry.firstPrompt,
          durationMs: parsed.durationMs,
        },
        false,
      );

      summaries.push(summary);
    } catch {
      // Skip problematic sessions
    }
  }

  if (summaries.length === 0) {
    console.error('分析可能なセッションがありませんでした。');
    process.exit(1);
  }

  const insights = aggregateInsights(summaries);

  if (options.format === 'json') {
    console.log(JSON.stringify(insights, null, 2));
    return;
  }

  formatInsightsText(insights);
}

function formatInsightsText(insights: InsightsSummary): void {
  console.log('=== プロジェクト横断インサイト ===\n');

  console.log(`分析セッション数: ${insights.totalSessions}`);
  console.log(`合計トークン: ${formatNumber(insights.totalTokens)}`);
  console.log(`合計コスト: ${formatUsd(insights.totalCost)}`);
  console.log('');

  // Project table
  console.log('--- プロジェクト別 ---');
  console.log(
    `  ${padRight('プロジェクト', 28)}${padLeft('セッション数', 14)}${padLeft('平均トークン', 14)}${padLeft('平均コスト', 12)}${padLeft('キャッシュ率', 13)}`,
  );

  for (const p of insights.projects) {
    console.log(
      `  ${padRight(p.projectName.slice(0, 26), 28)}${padLeft(String(p.sessionCount), 14)}${padLeft(formatNumber(p.averageTokens), 14)}${padLeft(formatUsd(p.averageCost), 12)}${padLeft(formatPercent(p.averageCacheHitRatio), 13)}`,
    );
  }
  console.log('');

  // Top tools
  if (insights.topTools.length > 0) {
    console.log('--- 高コストツールパターン ---');
    const topN = insights.topTools.slice(0, 10);
    for (const t of topN) {
      console.log(
        `  ${padRight(t.toolName, 20)} 呼出 ${padLeft(formatNumber(t.totalCalls), 6)}回, 合計 ${padLeft(formatNumber(t.totalResultSize), 10)} ch`,
      );
    }
    console.log('');
  }
}
