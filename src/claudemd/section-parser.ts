export interface MarkdownSection {
  heading: string;
  level: number; // 1 = #, 2 = ##, 3 = ###
  content: string; // Full content including sub-sections
  lineCount: number;
}

/**
 * Parse a markdown document into sections by heading level.
 * Only splits on top-level headings (## and ###).
 */
export function parseSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  function flush(): void {
    if (currentHeading || currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content) {
        sections.push({
          heading: currentHeading || '(前文)',
          level: currentLevel || 1,
          content,
          lineCount: currentLines.filter((l) => l.trim()).length,
        });
      }
    }
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      // Only split on level 2 headings (## sections)
      if (level <= 2) {
        flush();
        currentHeading = match[2].trim();
        currentLevel = level;
        currentLines = [];
        continue;
      }
    }
    currentLines.push(line);
  }

  flush();
  return sections;
}
