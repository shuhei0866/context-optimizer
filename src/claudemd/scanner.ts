import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getClaudeDir } from '../utils/paths.js';
import { findProjects } from '../session/reader.js';

export interface ClaudeMdFile {
  path: string;
  label: string; // e.g., "グローバル" or project name
  content: string;
}

/**
 * Find all CLAUDE.md files:
 * - Global: ~/.claude/CLAUDE.md
 * - Project-level: {projectRoot}/CLAUDE.md
 */
export function scanClaudeMdFiles(): ClaudeMdFile[] {
  const files: ClaudeMdFile[] = [];

  // Global CLAUDE.md
  const globalPath = join(getClaudeDir(), 'CLAUDE.md');
  if (existsSync(globalPath)) {
    files.push({
      path: globalPath,
      label: 'グローバル (~/.claude/CLAUDE.md)',
      content: readFileSync(globalPath, 'utf-8'),
    });
  }

  // Project-level CLAUDE.md files
  const projects = findProjects();
  const seen = new Set<string>();

  for (const project of projects) {
    if (!project.originalPath) continue;
    const projectClaudeMd = join(project.originalPath, 'CLAUDE.md');
    if (seen.has(projectClaudeMd)) continue;
    seen.add(projectClaudeMd);

    if (existsSync(projectClaudeMd)) {
      const projectName = project.originalPath.split('/').pop() || project.originalPath;
      files.push({
        path: projectClaudeMd,
        label: `プロジェクト: ${projectName}`,
        content: readFileSync(projectClaudeMd, 'utf-8'),
      });
    }
  }

  return files;
}
