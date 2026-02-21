import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { parseSession } from '../session/parser.js';
import { resolveSessionPaths } from '../session/reader.js';
import { analyzeSession } from '../analyzer/token-analyzer.js';
import { buildDiagnosticReport, type DiagnosticReport } from '../diagnose/analyzer.js';
import type { TurnData, SessionSummary } from '../session/types.js';
import { formatPercent, padRight, padLeft } from '../utils/format.js';

interface DiagnoseOptions {
  project?: string;
  limit: number;
  format: 'text' | 'json';
}

function parseArgs(args: string[]): DiagnoseOptions {
  const options: DiagnoseOptions = {
    limit: 30,
    format: 'text',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
        options.project = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10) || 30;
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'json';
        break;
    }
  }

  return options;
}

export async function runDiagnose(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (!options.project) {
    console.error('エラー: --project オプションは必須です。');
    process.exit(1);
  }

  const resolved = resolveSessionPaths(options.project);

  if (resolved.length === 0) {
    console.error(`エラー: プロジェクト "${options.project}" が見つかりません。`);
    process.exit(1);
  }

  const sessionsToAnalyze = resolved.slice(0, options.limit);
  console.error(`${sessionsToAnalyze.length} セッションを分析中...`);

  const parsedSessions: { sessionId: string; turns: TurnData[] }[] = [];
  const summaries: SessionSummary[] = [];

  for (const { sessionPath, projectInfo, sessionEntry } of sessionsToAnalyze) {
    if (!existsSync(sessionPath)) continue;

    try {
      const parsed = await parseSession(sessionPath, { includeFileAccess: true });
      if (parsed.turns.length === 0) continue;

      parsedSessions.push({
        sessionId: parsed.sessionId || sessionEntry.sessionId,
        turns: parsed.turns,
      });

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

  if (parsedSessions.length === 0) {
    console.error('分析可能なセッションがありませんでした。');
    process.exit(1);
  }

  const projectPath = resolved[0].sessionEntry.projectPath || resolved[0].projectInfo.originalPath;
  const report = buildDiagnosticReport(projectPath, parsedSessions, summaries);

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    formatDiagnoseText(report);
  }
}

function formatDiagnoseText(report: DiagnosticReport): void {
  const projectName = basename(report.projectPath) || report.projectPath;
  console.log(`=== コンテキスト診断: ${projectName} ===\n`);
  console.log(`分析: ${report.sessionsAnalyzed} セッション`);

  // CLAUDE.md ratio
  console.log('\n--- CLAUDE.md コンテキスト比率 ---');
  console.log(
    `  平均: ${formatPercent(report.claudeMdRatio.mean)}  中央値: ${formatPercent(report.claudeMdRatio.median)}`,
  );

  // Session length stats
  console.log('\n--- セッション長 ---');
  console.log(
    `  平均: ${report.sessionLengthStats.mean.toFixed(1)} ターン  中央値: ${report.sessionLengthStats.median} ターン  100超: ${report.sessionLengthStats.over100Turns} 件`,
  );

  // Exploration hotspots
  if (report.explorationHotspots.length > 0) {
    console.log('\n--- 探索ホットスポット ---');
    console.log(
      `  ${padRight('ディレクトリ', 44)}${padLeft('アクセス', 10)}${padLeft('ファイル数', 12)}  AGENTS.md`,
    );

    const topHotspots = report.explorationHotspots.slice(0, 15);
    for (const hs of topHotspots) {
      const dirDisplay = truncateDir(hs.directory, 42);
      const agentsMd = hs.hasAgentsMd ? 'あり ✓' : 'なし ⚠';
      console.log(
        `  ${padRight(dirDisplay, 44)}${padLeft(String(hs.totalAccesses), 10)}${padLeft(String(hs.uniqueFiles), 12)}  ${agentsMd}`,
      );
    }
  }

  // Read duplication
  console.log('\n--- Read 重複 ---');
  console.log(`  セッション内重複率: ${formatPercent(report.overallDuplicateReadRatio)}`);

  if (report.topDuplicateFiles.length > 0) {
    console.log('  最頻重複ファイル:');
    for (const f of report.topDuplicateFiles.slice(0, 10)) {
      const fileDisplay = truncateDir(f.filePath, 40);
      console.log(
        `    ${padRight(fileDisplay, 42)} ${padLeft(String(f.readCount), 4)}回 (${f.sessionIds.length}セッション)`,
      );
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log('\n--- 推奨事項 ---');
    for (const r of report.recommendations) {
      const icon = r.severity === 'warn' ? '⚠' : 'ℹ';
      console.log(`  ${icon} ${r.message}`);
    }
  }

  console.log('');
}

function truncateDir(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 3);
}
