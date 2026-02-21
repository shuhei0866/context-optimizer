import { existsSync, writeFileSync } from 'node:fs';
import { parseSession } from '../session/parser.js';
import { resolveSessionPaths } from '../session/reader.js';
import { analyzeSession } from '../analyzer/token-analyzer.js';
import { formatSessionSummary } from '../formatters/text.js';
import { formatSessionJson } from '../formatters/json.js';
import type { SessionSummary } from '../session/types.js';

interface AnalyzeOptions {
  session?: string;
  project?: string;
  all: boolean;
  last: boolean;
  perTurn: boolean;
  format: 'text' | 'json';
  exportPath?: string;
}

function parseArgs(args: string[]): AnalyzeOptions {
  const options: AnalyzeOptions = {
    all: false,
    last: true,
    perTurn: false,
    format: 'text',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--session':
        options.session = args[++i];
        options.last = false;
        break;
      case '--project':
        options.project = args[++i];
        break;
      case '--all':
        options.all = true;
        options.last = false;
        break;
      case '--last':
        options.last = true;
        break;
      case '--per-turn':
        options.perTurn = true;
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'json';
        break;
      case '--export':
        options.exportPath = args[++i];
        break;
    }
  }

  return options;
}

export async function runAnalyze(args: string[]): Promise<void> {
  const options = parseArgs(args);

  const resolved = resolveSessionPaths(
    options.project || (options.all ? undefined : undefined),
    options.session,
  );

  if (resolved.length === 0) {
    if (options.project) {
      console.error(`エラー: プロジェクト "${options.project}" が見つかりません。`);
    } else {
      console.error('エラー: セッションが見つかりません。~/.claude/projects/ を確認してください。');
    }
    process.exit(1);
  }

  // Filter: if --last, take only the most recent session (per project or globally)
  let sessionsToAnalyze = resolved;
  if (options.last && !options.session) {
    sessionsToAnalyze = [resolved[0]]; // Already sorted by modified desc
  }

  // If not --all and not --project, default to all projects but --last limits to 1
  if (!options.all && !options.project && !options.session) {
    sessionsToAnalyze = [resolved[0]];
  }

  const summaries: SessionSummary[] = [];

  for (const { sessionPath, projectInfo, sessionEntry } of sessionsToAnalyze) {
    if (!existsSync(sessionPath)) {
      console.error(`警告: セッションファイルが見つかりません: ${sessionPath}`);
      continue;
    }

    try {
      const parsed = await parseSession(sessionPath);
      if (parsed.turns.length === 0) {
        continue;
      }

      const summary = analyzeSession(
        parsed.turns,
        {
          sessionId: parsed.sessionId || sessionEntry.sessionId,
          projectPath: sessionEntry.projectPath || projectInfo.originalPath,
          gitBranch: parsed.gitBranch || sessionEntry.gitBranch,
          firstPrompt: parsed.firstPrompt || sessionEntry.firstPrompt,
          durationMs: parsed.durationMs,
        },
        options.perTurn,
      );

      summaries.push(summary);
    } catch (err) {
      console.error(`警告: セッション解析エラー (${sessionEntry.sessionId}): ${err}`);
    }
  }

  if (summaries.length === 0) {
    console.error('分析可能なセッションがありませんでした。');
    process.exit(1);
  }

  // Export to CSV if requested
  if (options.exportPath) {
    exportCsv(summaries, options.exportPath);
    console.error(`エクスポート: ${options.exportPath} (${summaries.length} sessions)`);
  }

  // Output
  if (options.format === 'json') {
    if (summaries.length === 1) {
      console.log(formatSessionJson(summaries[0]));
    } else {
      console.log(JSON.stringify(summaries, null, 2));
    }
  } else {
    for (const summary of summaries) {
      console.log(formatSessionSummary(summary));
      if (summaries.length > 1) console.log('');
    }
  }
}

function exportCsv(summaries: SessionSummary[], path: string): void {
  const headers = [
    'session_id',
    'project',
    'branch',
    'turns',
    'duration_min',
    'input_tokens',
    'cache_creation_tokens',
    'cache_read_tokens',
    'output_tokens',
    'total_tokens',
    'cumulative_input',
    'cache_hit_ratio',
    'cost_usd',
    'models',
    'top_tool',
    'top_tool_calls',
    'first_prompt',
  ];

  const rows = summaries.map((s) => {
    const cumulativeInput = s.turns
      ? s.turns.reduce((sum, t) => sum + t.totalInputTokens, 0)
      : s.totalTokens.input + s.totalTokens.cacheCreation + s.totalTokens.cacheRead;

    const topTool = s.toolRanking[0];

    return [
      s.sessionId,
      s.projectPath,
      s.gitBranch,
      s.turnCount,
      s.durationMs > 0 ? (s.durationMs / 60000).toFixed(1) : '',
      s.totalTokens.input,
      s.totalTokens.cacheCreation,
      s.totalTokens.cacheRead,
      s.totalTokens.output,
      s.totalTokens.total,
      cumulativeInput,
      (s.overallCacheHitRatio * 100).toFixed(1),
      s.totalCost.total.toFixed(3),
      s.modelsUsed.join('+'),
      topTool?.toolName || '',
      topTool?.callCount || 0,
      csvEscape(s.firstPrompt.slice(0, 100)),
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  writeFileSync(path, csv, 'utf-8');
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""').replace(/\n/g, ' ') + '"';
  }
  return s;
}
