import { callClaude } from '../utils/api.js';
import { getCached, setCache } from '../utils/cache.js';
import { estimateTokens } from '../claudemd/token-estimator.js';

export interface CompressionResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  reductionRate: number;
}

const COMPRESSION_PROMPT = `あなたはテキスト圧縮の専門家です。以下のルール文書のセクションを、意味を保ったまま約40%短縮してください。

制約:
- 具体的な禁止事項・手順は省略しない
- 箇条書きの統合・簡潔化で短縮する
- 抽象的な説明や補足は削除可
- マークダウン形式を維持する
- 日本語で出力する

圧縮後のテキストのみを出力してください。説明や前置きは不要です。`;

export async function compressSection(
  sectionText: string,
  model: string,
): Promise<CompressionResult> {
  const cacheInput = `${model}::${sectionText}`;
  const cached = getCached<CompressionResult>('compress', cacheInput);
  if (cached) return cached;

  const originalTokens = estimateTokens(sectionText);

  const response = await callClaude({
    model,
    system: COMPRESSION_PROMPT,
    messages: [{ role: 'user', content: sectionText }],
    maxTokens: Math.max(256, originalTokens * 2),
  });

  const compressed = response.content.trim();
  const compressedTokens = estimateTokens(compressed);

  const result: CompressionResult = {
    original: sectionText,
    compressed,
    originalTokens,
    compressedTokens,
    reductionRate: originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0,
  };

  setCache('compress', cacheInput, result);
  return result;
}
