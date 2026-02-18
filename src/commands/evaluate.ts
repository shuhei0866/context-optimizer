import { scanClaudeMdFiles } from '../claudemd/scanner.js';
import { parseSections } from '../claudemd/section-parser.js';
import { runEvalPipeline, getDryRunSummary } from '../evaluate/runner.js';
import { saveReport } from '../evaluate/report-store.js';
import { SECTION_META } from '../evaluate/test-cases.js';
import type { EvalOptions, EvalReport } from '../evaluate/types.js';
import { DEFAULT_EVAL_OPTIONS } from '../evaluate/types.js';
import { padRight, padLeft, formatPercent } from '../utils/format.js';

function parseArgs(args: string[]): EvalOptions {
  const options: EvalOptions = { ...DEFAULT_EVAL_OPTIONS };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--section':
        options.section = args[++i];
        break;
      case '--trials':
        options.trials = parseInt(args[++i], 10);
        break;
      case '--judge-model':
        options.judgeModel = args[++i];
        break;
      case '--subject-model':
        options.subjectModel = args[++i];
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'json';
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--save':
        options.save = true;
        break;
    }
  }
  return options;
}

export async function runEvaluate(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // グローバル CLAUDE.md を取得
  const files = scanClaudeMdFiles();
  const globalFile = files.find((f) => f.label.includes('グローバル') || f.label.includes('global'));
  if (!globalFile) {
    console.error('グローバル CLAUDE.md が見つかりません。');
    process.exit(1);
  }

  const sections = parseSections(globalFile.content);

  if (options.dryRun) {
    printDryRun(sections, options);
    return;
  }

  console.error('=== CLAUDE.md 圧縮品質評価 ===\n');
  console.error(`モデル: 被験者=${options.subjectModel}, 判定=${options.judgeModel}`);
  console.error(`試行数: ${options.trials}/セクション\n`);

  const report = await runEvalPipeline(sections, options, {
    onSectionStart: (heading, index, total) => {
      console.error(`[${index + 1}/${total}] ${heading} ...`);
    },
    onCompressionDone: (heading, rate) => {
      console.error(`  圧縮完了: ${formatPercent(rate)} 削減`);
    },
    onTestDone: (testId, condition, violated) => {
      const mark = violated ? 'x' : 'o';
      console.error(`  ${condition === 'original' ? '原文' : '圧縮'} ${testId}: ${mark}`);
    },
  });

  if (options.save) {
    const savedPath = saveReport(report);
    console.error(`\nレポート保存: ${savedPath}`);
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }
}

function printDryRun(
  sections: import('../claudemd/section-parser.js').MarkdownSection[],
  options: EvalOptions,
): void {
  const summary = getDryRunSummary(sections, options);

  console.log('=== dry-run: テストケース一覧 ===\n');

  for (const section of summary.sections) {
    console.log(`--- ${section.heading} (${section.sectionId}, 具体性: ${section.specificity}, ~${section.tokens} tok) ---`);
    for (const tc of section.testCases) {
      console.log(`  ${tc.id}: ${tc.scenario}`);
    }
    console.log('');
  }

  console.log(`推定 API 呼び出し数: ${summary.estimatedApiCalls}`);
  console.log(`推定コスト: ~$${((summary.estimatedApiCalls * 500 * 6) / 1_000_000).toFixed(3)}`);
}

function printTextReport(report: EvalReport): void {
  console.log('\n=== CLAUDE.md 圧縮品質評価 ===\n');

  // ヘッダー
  const headers = [
    padRight('セクション', 28),
    padLeft('原文tok', 8),
    padLeft('圧縮tok', 8),
    padLeft('削減率', 8),
    padLeft('違反(原文)', 12),
    padLeft('違反(圧縮)', 12),
    padLeft('Δ', 8),
    padLeft('判定一貫性', 10),
  ].join('');
  console.log(headers);

  for (const s of report.sections) {
    const origViolations = s.testResults.filter(
      (r) => r.condition === 'original' && r.violated,
    ).length;
    const origTotal = s.testResults.filter((r) => r.condition === 'original').length;
    const compViolations = s.testResults.filter(
      (r) => r.condition === 'compressed' && r.violated,
    ).length;
    const compTotal = s.testResults.filter((r) => r.condition === 'compressed').length;
    const reductionRate =
      s.originalTokens > 0 ? 1 - s.compressedTokens / s.originalTokens : 0;

    console.log(
      [
        padRight(s.sectionHeading.slice(0, 26), 28),
        padLeft(String(s.originalTokens), 8),
        padLeft(String(s.compressedTokens), 8),
        padLeft(formatPercent(reductionRate), 8),
        padLeft(`${origViolations}/${origTotal} (${formatPercent(s.violationRate_original)})`, 12),
        padLeft(`${compViolations}/${compTotal} (${formatPercent(s.violationRate_compressed)})`, 12),
        padLeft(formatPercent(s.delta), 8),
        padLeft(s.judgeAgreement.toFixed(2), 10),
      ].join(''),
    );
  }

  // 仮説検証
  console.log(`\n--- 仮説検証: 具体性 vs 判定一貫性 ---`);
  console.log(`相関: r = ${report.hypothesisResult.correlation.toFixed(2)}`);
  console.log(`所見: ${report.hypothesisResult.finding}`);

  // 最適化判断
  console.log(`\n--- 最適化判断 (qualityGate=0.9) ---`);
  const compressible = report.sections.filter((s) => s.violationRate_compressed <= 0.1);
  const needsReview = report.sections.filter(
    (s) => s.violationRate_compressed > 0.1 && s.violationRate_compressed <= 0.3,
  );
  const notRecommended = report.sections.filter((s) => s.violationRate_compressed > 0.3);

  if (compressible.length > 0) {
    console.log(`圧縮可: ${compressible.map((s) => s.sectionHeading).join(', ')} (violationRate <= 0.1)`);
  }
  if (needsReview.length > 0) {
    console.log(`要検討: ${needsReview.map((s) => s.sectionHeading).join(', ')}`);
  }
  if (notRecommended.length > 0) {
    console.log(`非推奨: ${notRecommended.map((s) => s.sectionHeading).join(', ')}`);
  }

  // 推定削減
  const totalOriginal = report.sections.reduce((sum, s) => sum + s.originalTokens, 0);
  const saveable = compressible.reduce((sum, s) => sum + (s.originalTokens - s.compressedTokens), 0);
  console.log(`\n推定削減: ${saveable} tok (対象セクション合計 ${totalOriginal} tok から ${formatPercent(totalOriginal > 0 ? saveable / totalOriginal : 0)} 削減)`);
  const cacheInfo = report.cacheHits > 0 ? ` (キャッシュヒット: ${report.cacheHits})` : '';
  console.log(`API 呼び出し数: ${report.totalApiCalls}${cacheInfo}, 推定コスト: ~$${report.estimatedCostUsd.toFixed(3)}`);
}
