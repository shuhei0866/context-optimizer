import type { SessionSummary, TurnData, ToolRankingEntry } from '../session/types.js';
import { formatNumber, formatUsd, formatPercent, formatDuration, padRight, padLeft } from '../utils/format.js';

export function formatSessionSummary(summary: SessionSummary): string {
  const lines: string[] = [];

  const shortId = summary.sessionId.slice(0, 8);
  const projectName = summary.projectPath
    ? summary.projectPath.split('/').pop() || summary.projectPath
    : '不明';
  const duration = summary.durationMs ? formatDuration(summary.durationMs) : '不明';

  lines.push(`=== セッション分析: ${shortId} ===`);
  lines.push(
    `プロジェクト: ${projectName} | ブランチ: ${summary.gitBranch || '不明'} | ターン数: ${summary.turnCount} | 所要時間: ${duration}`,
  );
  if (summary.firstPrompt) {
    const truncated = summary.firstPrompt.length > 80
      ? summary.firstPrompt.slice(0, 80) + '...'
      : summary.firstPrompt;
    lines.push(`最初のプロンプト: ${truncated}`);
  }
  lines.push('');

  // Token summary
  lines.push('--- トークンサマリ ---');
  lines.push(`  入力 (非キャッシュ):  ${padLeft(formatNumber(summary.totalTokens.input), 12)}`);
  lines.push(`  キャッシュ書き込み:  ${padLeft(formatNumber(summary.totalTokens.cacheCreation), 12)}`);
  lines.push(`  キャッシュ読み込み:  ${padLeft(formatNumber(summary.totalTokens.cacheRead), 12)}`);
  lines.push(`  出力:                ${padLeft(formatNumber(summary.totalTokens.output), 12)}`);
  lines.push(`  合計:                ${padLeft(formatNumber(summary.totalTokens.total), 12)}`);
  lines.push('');

  // Cost
  lines.push('--- コスト推定 ---');
  lines.push(`  入力:          ${padLeft(formatUsd(summary.totalCost.input), 10)}`);
  lines.push(`  キャッシュ書込: ${padLeft(formatUsd(summary.totalCost.cacheCreation), 10)}`);
  lines.push(`  キャッシュ読込: ${padLeft(formatUsd(summary.totalCost.cacheRead), 10)}`);
  lines.push(`  出力:          ${padLeft(formatUsd(summary.totalCost.output), 10)}`);
  lines.push(`  合計:          ${padLeft(formatUsd(summary.totalCost.total), 10)}`);
  lines.push('');

  // Cache efficiency
  lines.push('--- キャッシュ効率 ---');
  lines.push(`  全体ヒット率: ${formatPercent(summary.overallCacheHitRatio)}`);
  lines.push('');

  // Tool ranking
  if (summary.toolRanking.length > 0) {
    lines.push('--- ツール消費ランキング ---');
    lines.push(
      `  ${padRight('#', 4)}${padRight('ツール', 16)}${padLeft('呼出数', 8)}${padLeft('平均結果サイズ', 16)}${padLeft('合計コンテキスト', 18)}`,
    );
    for (let i = 0; i < summary.toolRanking.length; i++) {
      const tool = summary.toolRanking[i];
      lines.push(
        `  ${padRight(String(i + 1), 4)}${padRight(tool.toolName, 16)}${padLeft(String(tool.callCount), 8)}${padLeft(formatNumber(tool.averageResultSize) + ' ch', 16)}${padLeft(formatNumber(tool.totalResultSize) + ' ch', 18)}`,
      );
    }
    lines.push('');
  }

  // Models used
  if (summary.modelsUsed.length > 0) {
    lines.push(`使用モデル: ${summary.modelsUsed.join(', ')}`);
    lines.push('');
  }

  // Per-turn details
  if (summary.turns && summary.turns.length > 0) {
    lines.push('--- ターン別内訳 ---');
    for (const turn of summary.turns) {
      lines.push(formatTurn(turn));
    }
  }

  return lines.join('\n');
}

function formatTurn(turn: TurnData): string {
  const lines: string[] = [];
  const duration = turn.durationMs ? formatDuration(turn.durationMs) : '-';
  lines.push(
    `  [${turn.turnIndex}] ${turn.model} | ${duration} | 入力: ${formatNumber(turn.totalInputTokens)} | 出力: ${formatNumber(turn.outputTokens)} | キャッシュ率: ${formatPercent(turn.cacheHitRatio)} | コスト: ${formatUsd(turn.estimatedCost.total)}`,
  );
  if (turn.toolUses.length > 0) {
    const toolSummary = turn.toolUses
      .map((t) => `${t.toolName}×${t.callCount}`)
      .join(', ');
    lines.push(`       ツール: ${toolSummary}`);
  }
  return lines.join('\n');
}
