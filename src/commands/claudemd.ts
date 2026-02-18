import { scanClaudeMdFiles } from '../claudemd/scanner.js';
import { parseSections } from '../claudemd/section-parser.js';
import { estimateTokens, classifyVerbosity, type SectionTokenEstimate } from '../claudemd/token-estimator.js';
import { suggestOptimizations } from '../claudemd/optimizer-bridge.js';
import { padRight, padLeft, formatNumber, formatPercent } from '../utils/format.js';

interface ClaudeMdOptions {
  format: 'text' | 'json';
}

function parseArgs(args: string[]): ClaudeMdOptions {
  const options: ClaudeMdOptions = { format: 'text' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format') {
      options.format = args[++i] as 'text' | 'json';
    }
  }
  return options;
}

export async function runClaudemd(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const files = scanClaudeMdFiles();

  if (files.length === 0) {
    console.error('CLAUDE.md ファイルが見つかりません。');
    process.exit(1);
  }

  if (options.format === 'json') {
    const results = files.map((file) => {
      const sections = parseSections(file.content);
      const totalTokens = estimateTokens(file.content);
      const totalLines = file.content.split('\n').length;
      const sectionEstimates = sections.map((s) => {
        const tokens = estimateTokens(s.content);
        return {
          heading: s.heading,
          tokens,
          percentage: totalTokens > 0 ? tokens / totalTokens : 0,
          lineCount: s.lineCount,
          status: classifyVerbosity(tokens),
        };
      });
      const suggestions = suggestOptimizations(sections);
      return {
        path: file.path,
        label: file.label,
        totalTokens,
        totalLines,
        sections: sectionEstimates,
        suggestions,
      };
    });
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Text output
  console.log('=== CLAUDE.md 分析 ===\n');

  for (const file of files) {
    const sections = parseSections(file.content);
    const totalTokens = estimateTokens(file.content);
    const totalLines = file.content.split('\n').length;

    console.log(`--- ${file.label} ---`);
    console.log(`合計: ~${formatNumber(totalTokens)} トークン (${totalLines}行)\n`);

    // Section table
    console.log(
      `  ${padRight('セクション', 36)}${padLeft('トークン', 10)}${padLeft('割合', 8)}${padLeft('状態', 14)}`,
    );

    for (const section of sections) {
      const tokens = estimateTokens(section.content);
      const pct = totalTokens > 0 ? tokens / totalTokens : 0;
      const status = classifyVerbosity(tokens);
      const statusLabel =
        status === 'very-verbose' ? '⚠ 非常に冗長' : status === 'verbose' ? '⚠ 冗長' : 'ok';

      console.log(
        `  ${padRight(section.heading.slice(0, 34), 36)}${padLeft(String(tokens), 10)}${padLeft(formatPercent(pct), 8)}${padLeft(statusLabel, 14)}`,
      );
    }

    console.log('');

    // Optimization suggestions
    const suggestions = suggestOptimizations(sections);
    if (suggestions.length > 0) {
      console.log('--- 最適化提案 (圧縮優先度) ---');
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i];
        console.log(`  ${i + 1}. [${s.priority}] ${s.heading} (${s.tokens} tok) — ${s.reason}`);
      }
      console.log('');
    }
  }
}
