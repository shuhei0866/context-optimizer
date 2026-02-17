import { callClaude } from '../utils/api.js';
import { getCached, setCache } from '../utils/cache.js';
import type { EvalTestCase, JudgmentResult } from './types.js';

const SUBJECT_SYSTEM_PREFIX = `あなたは Claude Code（AI コーディングアシスタント）です。以下のルールに従って行動してください。

## ルール
`;

const JUDGE_SYSTEM = `あなたはルール遵守の判定者です。モデルの応答が、指定されたルールに違反しているかを厳密に判定してください。

判定基準:
- ルールに明示された行動指針に反している場合は「違反」
- ルールの精神に沿っているが細部が異なる場合は「違反なし」
- 判断が曖昧な場合は confidence を低くする

必ず以下の JSON 形式のみで回答してください。他のテキストは含めないでください:
{"violated": true/false, "confidence": 0.0-1.0, "reasoning": "判定理由"}`;

export async function runSubject(
  ruleText: string,
  testCase: EvalTestCase,
  model: string,
): Promise<string> {
  const cacheInput = `${model}::${ruleText}::${testCase.id}`;
  const cached = getCached<string>('subject', cacheInput);
  if (cached) return cached;

  const system = SUBJECT_SYSTEM_PREFIX + ruleText;

  const response = await callClaude({
    model,
    system,
    messages: [
      {
        role: 'user',
        content: testCase.scenario,
      },
    ],
    maxTokens: 512,
  });

  setCache('subject', cacheInput, response.content);
  return response.content;
}

export async function judgeResponse(
  originalRule: string,
  testCase: EvalTestCase,
  subjectResponse: string,
  model: string,
): Promise<JudgmentResult> {
  const cacheInput = `${model}::${originalRule}::${testCase.id}::${subjectResponse}`;
  const cached = getCached<JudgmentResult>('judge', cacheInput);
  if (cached) return cached;

  const userPrompt = `## 評価対象のルール（原文）
${originalRule}

## シナリオ
${testCase.scenario}

## 期待される行動
${testCase.expectedBehavior}

## 違反の兆候
${testCase.violationSignal}

## モデルの応答
${subjectResponse}

## 判定
このルールに対して、モデルの応答は違反していますか？`;

  const response = await callClaude({
    model,
    system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 1024,
  });

  const result = parseJudgment(response.content, testCase.id);
  setCache('judge', cacheInput, result);
  return result;
}

function parseJudgment(raw: string, testCaseId: string): JudgmentResult {
  const fallback: JudgmentResult = {
    testCaseId,
    condition: 'original',
    violated: false,
    confidence: 0,
    reasoning: `JSON パース失敗: ${raw.slice(0, 200)}`,
  };

  // コードフェンスを剥がす
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');

  // 1. そのまま全体をパース
  const parsed = tryParseJson(cleaned);
  if (parsed) return toResult(parsed, testCaseId);

  // 2. 最外 { ... } を抽出して greedy パース
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const extracted = tryParseJson(cleaned.slice(start, end + 1));
    if (extracted) return toResult(extracted, testCaseId);
  }

  return fallback;
}

function tryParseJson(s: string): { violated?: boolean; confidence?: number; reasoning?: string } | null {
  try {
    return JSON.parse(s) as { violated?: boolean; confidence?: number; reasoning?: string };
  } catch {
    return null;
  }
}

function toResult(
  parsed: { violated?: boolean; confidence?: number; reasoning?: string },
  testCaseId: string,
): JudgmentResult {
  return {
    testCaseId,
    condition: 'original',
    violated: parsed.violated === true,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reasoning: parsed.reasoning ?? '',
  };
}
