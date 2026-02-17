import type { VariantSpec } from '../core/types.js';
import type { MarkdownSection } from '../claudemd/section-parser.js';
import { estimateTokens } from '../claudemd/token-estimator.js';
import { cacheStats, resetCacheStats } from '../utils/cache.js';
import { compressSection } from './compressor.js';
import { runSubject, judgeResponse } from './judge.js';
import { getTestCasesForSection, findSectionMeta, SECTION_META } from './test-cases.js';
import type {
  EvalOptions,
  SectionEvalReport,
  EvalReport,
  JudgmentResult,
  HypothesisResult,
} from './types.js';

export interface RunnerCallbacks {
  onSectionStart?: (heading: string, index: number, total: number) => void;
  onCompressionDone?: (heading: string, reductionRate: number) => void;
  onTestStart?: (testId: string, condition: 'original' | 'compressed') => void;
  onTestDone?: (testId: string, condition: 'original' | 'compressed', violated: boolean) => void;
}

export async function runEvalPipeline(
  sections: MarkdownSection[],
  options: EvalOptions,
  callbacks?: RunnerCallbacks,
): Promise<EvalReport> {
  const targetSections = filterSections(sections, options.section);
  const sectionReports: SectionEvalReport[] = [];
  resetCacheStats();

  for (let i = 0; i < targetSections.length; i++) {
    const section = targetSections[i];
    const meta = findSectionMeta(section.heading);
    if (!meta) continue;

    callbacks?.onSectionStart?.(section.heading, i, targetSections.length);

    const testCases = getTestCasesForSection(meta.sectionId).slice(0, options.trials);
    if (testCases.length === 0) continue;

    // Step 1: 圧縮
    const compression = await compressSection(section.content, options.subjectModel);
    callbacks?.onCompressionDone?.(section.heading, compression.reductionRate);

    // Step 2: 被験者実行 + 判定（original）
    const originalResults: JudgmentResult[] = [];
    for (const tc of testCases) {
      callbacks?.onTestStart?.(tc.id, 'original');
      const subjectResp = await runSubject(section.content, tc, options.subjectModel);
      const judgment = await judgeResponse(section.content, tc, subjectResp, options.judgeModel);
      const result: JudgmentResult = { ...judgment, condition: 'original' };
      originalResults.push(result);
      callbacks?.onTestDone?.(tc.id, 'original', result.violated);
    }

    // Step 3: 被験者実行 + 判定（compressed）
    const compressedResults: JudgmentResult[] = [];
    for (const tc of testCases) {
      callbacks?.onTestStart?.(tc.id, 'compressed');
      const subjectResp = await runSubject(compression.compressed, tc, options.subjectModel);
      const judgment = await judgeResponse(section.content, tc, subjectResp, options.judgeModel);
      const result: JudgmentResult = { ...judgment, condition: 'compressed' };
      compressedResults.push(result);
      callbacks?.onTestDone?.(tc.id, 'compressed', result.violated);
    }

    // Step 4: 集計
    const violationRate_original = calcViolationRate(originalResults);
    const violationRate_compressed = calcViolationRate(compressedResults);
    const judgeAgreement = calcJudgeAgreement([...originalResults, ...compressedResults]);

    sectionReports.push({
      sectionId: meta.sectionId,
      sectionHeading: section.heading,
      originalTokens: compression.originalTokens,
      compressedTokens: compression.compressedTokens,
      compressedText: compression.compressed,
      violationRate_original,
      violationRate_compressed,
      delta: violationRate_compressed - violationRate_original,
      judgeAgreement,
      testResults: [...originalResults, ...compressedResults],
    });
  }

  const hypothesisResult = analyzeHypothesis(sectionReports);
  const variantSpecs = buildVariantSpecs(sectionReports);

  const { hits, misses } = cacheStats();
  const totalApiCalls = misses; // cache miss = actual API call

  // コスト概算: Haiku $1/$5 per Mtok, 平均 ~500 tok/call
  const avgTokensPerCall = 500;
  const inputCost = (totalApiCalls * avgTokensPerCall * 1) / 1_000_000;
  const outputCost = (totalApiCalls * avgTokensPerCall * 5) / 1_000_000;
  const estimatedCostUsd = inputCost + outputCost;

  return {
    sections: sectionReports,
    hypothesisResult,
    variantSpecs,
    totalApiCalls,
    cacheHits: hits,
    estimatedCostUsd,
  };
}

function filterSections(sections: MarkdownSection[], sectionFilter?: string): MarkdownSection[] {
  if (!sectionFilter) {
    return sections.filter((s) => findSectionMeta(s.heading) !== undefined);
  }
  return sections.filter(
    (s) => findSectionMeta(s.heading)?.sectionId === sectionFilter || s.heading.includes(sectionFilter),
  );
}

function calcViolationRate(results: JudgmentResult[]): number {
  if (results.length === 0) return 0;
  const violations = results.filter((r) => r.violated).length;
  return violations / results.length;
}

function calcJudgeAgreement(results: JudgmentResult[]): number {
  if (results.length === 0) return 1;
  // confidence の平均を agreement の代理指標として使用
  const totalConfidence = results.reduce((sum, r) => sum + r.confidence, 0);
  return totalConfidence / results.length;
}

function analyzeHypothesis(reports: SectionEvalReport[]): HypothesisResult {
  if (reports.length < 3) {
    return { correlation: 0, finding: 'セクション数が不足のため相関分析不可' };
  }

  // 具体性スコア: high=3, medium=2, low=1
  const specificityScore: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const pairs: Array<{ specificity: number; agreement: number }> = [];

  for (const report of reports) {
    const meta = SECTION_META.find((m) => m.sectionId === report.sectionId);
    if (!meta) continue;
    pairs.push({
      specificity: specificityScore[meta.specificity],
      agreement: report.judgeAgreement,
    });
  }

  const correlation = pearsonCorrelation(
    pairs.map((p) => p.specificity),
    pairs.map((p) => p.agreement),
  );

  let finding: string;
  if (correlation > 0.5) {
    finding = '具体的なルールほど判定が一貫している（仮説支持）';
  } else if (correlation < -0.5) {
    finding = '具体性と判定一貫性に負の相関（仮説と逆）';
  } else {
    finding = '具体性と判定一貫性に明確な相関なし';
  }

  return { correlation, finding };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function buildVariantSpecs(reports: SectionEvalReport[]): VariantSpec[] {
  return reports
    .filter((r) => r.compressedTokens < r.originalTokens)
    .map((r, i) => ({
      variantId: `eval-compress-${r.sectionId}`,
      taskId: `section-${r.sectionId}`,
      name: `${r.sectionHeading} 圧縮版（実測）`,
      reducedTokens: r.originalTokens - r.compressedTokens,
      successRate: 1 - r.violationRate_compressed,
      violationRate: r.violationRate_compressed,
      requiredEffort: 1,
    }));
}

// dry-run 用: テストケース一覧を返す
export function getDryRunSummary(
  sections: MarkdownSection[],
  options: EvalOptions,
): {
  sections: Array<{
    heading: string;
    sectionId: string;
    specificity: string;
    tokens: number;
    testCases: Array<{ id: string; scenario: string }>;
  }>;
  estimatedApiCalls: number;
} {
  const targetSections = sections.filter((s) => {
    const meta = findSectionMeta(s.heading);
    if (!meta) return false;
    if (options.section) {
      return meta.sectionId === options.section || s.heading.includes(options.section);
    }
    return true;
  });

  let estimatedApiCalls = 0;
  const result = targetSections
    .map((section) => {
      const meta = findSectionMeta(section.heading);
      if (!meta) return null;
      const testCases = getTestCasesForSection(meta.sectionId).slice(0, options.trials);
      // Per section: 1 compression + (trials * 2 conditions * 2 calls)
      estimatedApiCalls += 1 + testCases.length * 2 * 2;
      return {
        heading: section.heading,
        sectionId: meta.sectionId,
        specificity: meta.specificity,
        tokens: estimateTokens(section.content),
        testCases: testCases.map((tc) => ({ id: tc.id, scenario: tc.scenario })),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return { sections: result, estimatedApiCalls };
}
