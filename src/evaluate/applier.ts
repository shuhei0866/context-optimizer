import type { MarkdownSection } from '../claudemd/section-parser.js';
import type { SectionEvalReport } from './types.js';

export interface ApplyProposal {
  sectionHeading: string;
  originalText: string;
  compressedText: string;
  originalTokens: number;
  compressedTokens: number;
  violationRate: number;
  judgeAgreement: number;
}

/**
 * Build filtered proposals from eval results.
 * Only includes sections where violationRate_compressed <= maxViolationRate.
 * Matches by heading text (SectionEvalReport.sectionHeading vs MarkdownSection.heading).
 */
export function buildProposals(
  sections: MarkdownSection[],
  evalSections: SectionEvalReport[],
  maxViolationRate: number = 0.1,
): ApplyProposal[] {
  const proposals: ApplyProposal[] = [];

  for (const evalSection of evalSections) {
    // Filter by violation rate
    if (evalSection.violationRate_compressed > maxViolationRate) {
      continue;
    }

    // Skip if no actual reduction
    if (evalSection.compressedTokens >= evalSection.originalTokens) {
      continue;
    }

    // Match with parsed sections by heading
    const matchedSection = sections.find((s) => s.heading === evalSection.sectionHeading);
    if (!matchedSection) {
      console.error(`警告: セクション "${evalSection.sectionHeading}" が CLAUDE.md に見つかりません（スキップ）`);
      continue;
    }

    proposals.push({
      sectionHeading: evalSection.sectionHeading,
      originalText: matchedSection.content,
      compressedText: evalSection.compressedText,
      originalTokens: evalSection.originalTokens,
      compressedTokens: evalSection.compressedTokens,
      violationRate: evalSection.violationRate_compressed,
      judgeAgreement: evalSection.judgeAgreement,
    });
  }

  return proposals;
}

/**
 * Apply proposals to the original CLAUDE.md content.
 * Replaces each section's content (between its heading and the next same-or-higher-level heading).
 */
export function applyProposals(
  originalContent: string,
  proposals: ApplyProposal[],
): string {
  let result = originalContent;

  for (const proposal of proposals) {
    result = replaceSection(result, proposal.sectionHeading, proposal.compressedText);
  }

  return result;
}

/**
 * Replace the content of a ## section in the markdown document.
 * Finds the heading line, then replaces content up to the next ## or higher heading.
 */
function replaceSection(content: string, heading: string, newContent: string): string {
  const lines = content.split('\n');
  let startIdx = -1;
  let headingLevel = 0;

  // Find the heading line
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,3})\s+(.+)$/);
    if (match && match[2].trim() === heading) {
      startIdx = i;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startIdx === -1) {
    console.error(`警告: 見出し "${heading}" が見つかりません（スキップ）`);
    return content;
  }

  // Find the end of this section (next heading of same or higher level)
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,3})\s+/);
    if (match && match[1].length <= headingLevel) {
      endIdx = i;
      break;
    }
  }

  // Rebuild: heading line + new content + rest
  const before = lines.slice(0, startIdx + 1); // includes the heading line
  const after = lines.slice(endIdx);

  // Ensure proper spacing
  const newSection = newContent.trim();
  const rebuilt = [...before, '', newSection, '', ...after];

  return rebuilt.join('\n');
}
