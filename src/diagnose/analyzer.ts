import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TurnData, FileAccess, SessionSummary } from '../session/types.js';

export interface FileAccessSummary {
  filePath: string;
  directory: string;
  readCount: number;
  writeCount: number;
  grepCount: number;
  totalResultSize: number;
  sessionIds: string[];
}

export interface DirectoryHotspot {
  directory: string;
  totalAccesses: number;
  uniqueFiles: number;
  hasAgentsMd: boolean;
  readDuplicateRatio: number;
  topFiles: { filePath: string; count: number }[];
}

export interface DiagnosticReport {
  projectPath: string;
  sessionsAnalyzed: number;
  claudeMdRatio: {
    mean: number;
    median: number;
  };
  explorationHotspots: DirectoryHotspot[];
  overallDuplicateReadRatio: number;
  topDuplicateFiles: FileAccessSummary[];
  sessionLengthStats: {
    mean: number;
    median: number;
    over100Turns: number;
  };
  recommendations: Recommendation[];
}

export interface Recommendation {
  type: 'agents-md-missing' | 'high-duplication' | 'claude-md-large' | 'session-too-long';
  severity: 'info' | 'warn';
  message: string;
  directory?: string;
}

/**
 * Aggregate file accesses from parsed sessions into per-file summaries.
 */
export function aggregateFileAccesses(
  sessions: { sessionId: string; turns: TurnData[] }[],
): FileAccessSummary[] {
  const index = new Map<string, FileAccessSummary>();

  for (const session of sessions) {
    for (const turn of session.turns) {
      if (!turn.fileAccesses) continue;
      for (const fa of turn.fileAccesses) {
        let entry = index.get(fa.filePath);
        if (!entry) {
          entry = {
            filePath: fa.filePath,
            directory: fa.directory,
            readCount: 0,
            writeCount: 0,
            grepCount: 0,
            totalResultSize: 0,
            sessionIds: [],
          };
          index.set(fa.filePath, entry);
        }

        switch (fa.operation) {
          case 'read':
            entry.readCount++;
            break;
          case 'write':
          case 'edit':
            entry.writeCount++;
            break;
          case 'grep':
          case 'glob':
            entry.grepCount++;
            break;
        }
        entry.totalResultSize += fa.resultSize;

        if (!entry.sessionIds.includes(session.sessionId)) {
          entry.sessionIds.push(session.sessionId);
        }
      }
    }
  }

  return [...index.values()];
}

/**
 * Build directory-level hotspots from file access summaries.
 */
export function buildDirectoryHotspots(
  summaries: FileAccessSummary[],
  projectRoot: string,
): DirectoryHotspot[] {
  const dirIndex = new Map<
    string,
    {
      totalAccesses: number;
      files: Map<string, number>;
      readPerFile: Map<string, number>;
    }
  >();

  for (const s of summaries) {
    const dir = s.directory;
    let entry = dirIndex.get(dir);
    if (!entry) {
      entry = { totalAccesses: 0, files: new Map(), readPerFile: new Map() };
      dirIndex.set(dir, entry);
    }

    const total = s.readCount + s.writeCount + s.grepCount;
    entry.totalAccesses += total;
    entry.files.set(s.filePath, (entry.files.get(s.filePath) || 0) + total);

    if (s.readCount > 0) {
      entry.readPerFile.set(s.filePath, (entry.readPerFile.get(s.filePath) || 0) + s.readCount);
    }
  }

  const hotspots: DirectoryHotspot[] = [];

  for (const [dir, data] of dirIndex) {
    // Check AGENTS.md existence
    const hasAgentsMd = existsSync(join(dir, 'AGENTS.md'));

    // Calculate read duplicate ratio
    let totalReads = 0;
    let duplicateReads = 0;
    for (const count of data.readPerFile.values()) {
      totalReads += count;
      if (count > 1) {
        duplicateReads += count - 1;
      }
    }
    const readDuplicateRatio = totalReads > 0 ? duplicateReads / totalReads : 0;

    // Top files by access count
    const topFiles = [...data.files.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([filePath, count]) => ({ filePath, count }));

    hotspots.push({
      directory: dir,
      totalAccesses: data.totalAccesses,
      uniqueFiles: data.files.size,
      hasAgentsMd,
      readDuplicateRatio,
      topFiles,
    });
  }

  return hotspots.sort((a, b) => b.totalAccesses - a.totalAccesses);
}

/**
 * Estimate CLAUDE.md context ratio from session data.
 *
 * Heuristic: In the first turn, cache_creation_input_tokens represents the system prompt
 * (CLAUDE.md + tool definitions). We estimate CLAUDE.md as a fraction of this.
 * This is approximate — JSONL doesn't expose the exact breakdown.
 */
export function calculateClaudeMdRatio(
  sessions: { turns: TurnData[] }[],
): { mean: number; median: number } {
  const ratios: number[] = [];

  for (const session of sessions) {
    if (session.turns.length < 2) continue;

    const firstTurn = session.turns[0];
    const totalFirst = firstTurn.totalInputTokens;
    if (totalFirst === 0) continue;

    // System prompt is mostly in cache_creation on first turn
    // Tool definitions are ~fixed (~8K tokens), CLAUDE.md varies
    // We estimate system prompt portion = cacheCreation / totalInput for first turn
    // Then subtract estimated tool definition overhead (~8000 tokens)
    const systemPromptTokens = firstTurn.cacheCreationTokens;
    const estimatedToolDefs = 8000;
    const estimatedClaudeMd = Math.max(0, systemPromptTokens - estimatedToolDefs);

    // Ratio relative to total context at a mid-session turn
    const midTurn = session.turns[Math.floor(session.turns.length / 2)];
    const midTotal = midTurn.totalInputTokens;
    if (midTotal === 0) continue;

    ratios.push(estimatedClaudeMd / midTotal);
  }

  if (ratios.length === 0) return { mean: 0, median: 0 };

  ratios.sort((a, b) => a - b);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const median = ratios[Math.floor(ratios.length / 2)];

  return { mean, median };
}

/**
 * Calculate per-session read duplicate ratio and overall average.
 */
export function calculateDuplicateReadRatio(
  sessions: { turns: TurnData[] }[],
): { overall: number; topFiles: FileAccessSummary[] } {
  let totalReads = 0;
  let duplicateReads = 0;

  // Per-session file read counts
  const globalFileCounts = new Map<string, { total: number; sessions: Set<string> }>();
  let sessionIdx = 0;

  for (const session of sessions) {
    const sessionFileReads = new Map<string, number>();
    sessionIdx++;

    for (const turn of session.turns) {
      if (!turn.fileAccesses) continue;
      for (const fa of turn.fileAccesses) {
        if (fa.operation !== 'read') continue;
        sessionFileReads.set(fa.filePath, (sessionFileReads.get(fa.filePath) || 0) + 1);
      }
    }

    for (const [filePath, count] of sessionFileReads) {
      totalReads += count;
      if (count > 1) {
        duplicateReads += count - 1;
      }

      let global = globalFileCounts.get(filePath);
      if (!global) {
        global = { total: 0, sessions: new Set() };
        globalFileCounts.set(filePath, global);
      }
      global.total += count;
      global.sessions.add(String(sessionIdx));
    }
  }

  const overall = totalReads > 0 ? duplicateReads / totalReads : 0;

  // Top duplicate files
  const topFiles: FileAccessSummary[] = [...globalFileCounts.entries()]
    .filter(([, v]) => v.total > 1)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([filePath, v]) => ({
      filePath,
      directory: dirname(filePath),
      readCount: v.total,
      writeCount: 0,
      grepCount: 0,
      totalResultSize: 0,
      sessionIds: [...v.sessions],
    }));

  return { overall, topFiles };
}

/**
 * Generate diagnostic recommendations based on analysis results.
 */
export function generateRecommendations(
  hotspots: DirectoryHotspot[],
  claudeMdRatio: { mean: number; median: number },
  sessionStats: { mean: number; median: number; over100Turns: number },
  duplicateReadRatio: number,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // agents-md-missing: directories with >10 accesses and no AGENTS.md
  for (const hs of hotspots) {
    if (!hs.hasAgentsMd && hs.totalAccesses > 10) {
      recommendations.push({
        type: 'agents-md-missing',
        severity: 'warn',
        message: `${hs.directory} に AGENTS.md がありません（${hs.totalAccesses}回アクセス）`,
        directory: hs.directory,
      });
    }
  }

  // high-duplication
  if (duplicateReadRatio > 0.15) {
    recommendations.push({
      type: 'high-duplication',
      severity: 'warn',
      message: `セッション内 Read 重複率が ${(duplicateReadRatio * 100).toFixed(1)}% です。AGENTS.md でファイル構造を説明することで削減できます`,
    });
  }

  // claude-md-large
  if (claudeMdRatio.mean > 0.25) {
    recommendations.push({
      type: 'claude-md-large',
      severity: 'warn',
      message: `CLAUDE.md のコンテキスト比率が平均 ${(claudeMdRatio.mean * 100).toFixed(1)}% です。圧縮を検討してください（claudemd コマンド参照）`,
    });
  }

  // session-too-long
  if (sessionStats.over100Turns > 0) {
    recommendations.push({
      type: 'session-too-long',
      severity: 'info',
      message: `100ターン超のセッションが ${sessionStats.over100Turns} 件あります。セッション分割を検討してください`,
    });
  }

  return recommendations;
}

/**
 * Run full diagnostic analysis on parsed sessions.
 */
export function buildDiagnosticReport(
  projectPath: string,
  sessions: { sessionId: string; turns: TurnData[] }[],
  summaries: SessionSummary[],
): DiagnosticReport {
  // File access aggregation
  const fileAccessSummaries = aggregateFileAccesses(sessions);
  const hotspots = buildDirectoryHotspots(fileAccessSummaries, projectPath);

  // CLAUDE.md ratio
  const claudeMdRatio = calculateClaudeMdRatio(sessions);

  // Duplicate read ratio
  const { overall: overallDuplicateReadRatio, topFiles: topDuplicateFiles } =
    calculateDuplicateReadRatio(sessions);

  // Session length stats
  const turnCounts = summaries.map((s) => s.turnCount);
  turnCounts.sort((a, b) => a - b);
  const meanTurns = turnCounts.length > 0
    ? turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length
    : 0;
  const medianTurns = turnCounts.length > 0
    ? turnCounts[Math.floor(turnCounts.length / 2)]
    : 0;
  const over100Turns = turnCounts.filter((t) => t > 100).length;

  const sessionLengthStats = { mean: meanTurns, median: medianTurns, over100Turns };

  // Recommendations
  const recommendations = generateRecommendations(
    hotspots,
    claudeMdRatio,
    sessionLengthStats,
    overallDuplicateReadRatio,
  );

  return {
    projectPath,
    sessionsAnalyzed: sessions.length,
    claudeMdRatio,
    explorationHotspots: hotspots,
    overallDuplicateReadRatio,
    topDuplicateFiles,
    sessionLengthStats,
    recommendations,
  };
}
