/**
 * Estimate token count for a text string.
 *
 * Heuristic:
 * - English/ASCII: ~4 characters per token
 * - CJK (Japanese, Chinese, Korean): ~1.5 characters per token
 * - Mixed content: weighted average based on character distribution
 */
export function estimateTokens(text: string): number {
  let cjkChars = 0;
  let asciiChars = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (isCjk(code)) {
      cjkChars++;
    } else if (code >= 0x20 && code <= 0x7e) {
      asciiChars++;
    }
    // Whitespace and other characters are counted as ASCII
  }

  const totalChars = text.length;
  if (totalChars === 0) return 0;

  // CJK tokens: ~1.5 chars per token
  const cjkTokens = cjkChars / 1.5;
  // ASCII tokens: ~4 chars per token
  const asciiTokens = (totalChars - cjkChars) / 4;

  return Math.round(cjkTokens + asciiTokens);
}

function isCjk(code: number): boolean {
  return (
    // CJK Unified Ideographs
    (code >= 0x4e00 && code <= 0x9fff) ||
    // CJK Extension A
    (code >= 0x3400 && code <= 0x4dbf) ||
    // Hiragana
    (code >= 0x3040 && code <= 0x309f) ||
    // Katakana
    (code >= 0x30a0 && code <= 0x30ff) ||
    // Hangul Syllables
    (code >= 0xac00 && code <= 0xd7af) ||
    // CJK Compatibility Ideographs
    (code >= 0xf900 && code <= 0xfaff) ||
    // Fullwidth forms
    (code >= 0xff00 && code <= 0xffef)
  );
}

export interface SectionTokenEstimate {
  heading: string;
  tokens: number;
  percentage: number;
  lineCount: number;
  status: 'ok' | 'verbose' | 'very-verbose';
}

/**
 * Classify section verbosity based on token count.
 */
export function classifyVerbosity(tokens: number): 'ok' | 'verbose' | 'very-verbose' {
  if (tokens >= 300) return 'very-verbose';
  if (tokens >= 150) return 'verbose';
  return 'ok';
}
