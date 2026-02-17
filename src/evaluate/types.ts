import type { VariantSpec } from '../core/types.js';

export interface EvalTestCase {
  id: string;
  sectionId: string;
  scenario: string;
  expectedBehavior: string;
  violationSignal: string;
}

export interface JudgmentResult {
  testCaseId: string;
  condition: 'original' | 'compressed';
  violated: boolean;
  confidence: number;
  reasoning: string;
}

export interface SectionEvalReport {
  sectionId: string;
  sectionHeading: string;
  originalTokens: number;
  compressedTokens: number;
  compressedText: string;
  violationRate_original: number;
  violationRate_compressed: number;
  delta: number;
  judgeAgreement: number;
  testResults: JudgmentResult[];
}

export interface HypothesisResult {
  correlation: number;
  finding: string;
}

export interface EvalReport {
  sections: SectionEvalReport[];
  hypothesisResult: HypothesisResult;
  variantSpecs: VariantSpec[];
  totalApiCalls: number;
  cacheHits: number;
  estimatedCostUsd: number;
}

export interface EvalOptions {
  section?: string;
  trials: number;
  judgeModel: string;
  subjectModel: string;
  format: 'text' | 'json';
  dryRun: boolean;
}

export const DEFAULT_EVAL_OPTIONS: EvalOptions = {
  trials: 4,
  judgeModel: 'claude-haiku-4-5-20251001',
  subjectModel: 'claude-haiku-4-5-20251001',
  format: 'text',
  dryRun: false,
};
