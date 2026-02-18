import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ProjectInfo, SessionIndex, SessionIndexEntry } from './types.js';
import { getProjectsDir } from '../utils/paths.js';

/**
 * Find all Claude Code projects.
 */
export function findProjects(claudeProjectsDir?: string): ProjectInfo[] {
  const projectsDir = claudeProjectsDir || getProjectsDir();
  if (!existsSync(projectsDir)) return [];

  const entries = readdirSync(projectsDir, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(projectsDir, entry.name);

    // Try to read sessions-index.json to get original path
    let originalPath = '';
    const indexPath = join(projectDir, 'sessions-index.json');
    if (existsSync(indexPath)) {
      try {
        const index: SessionIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
        originalPath = index.originalPath || '';
      } catch {
        // Ignore parse errors
      }
    }

    projects.push({
      encodedName: entry.name,
      originalPath,
      projectDir,
    });
  }

  return projects;
}

/**
 * Find sessions for a given project directory.
 */
export function findSessions(projectDir: string): SessionIndexEntry[] {
  const indexPath = join(projectDir, 'sessions-index.json');
  if (!existsSync(indexPath)) {
    // Fallback: scan for .jsonl files directly
    return scanJsonlFiles(projectDir);
  }

  try {
    const index: SessionIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
    return index.entries
      .filter((e) => !e.isSidechain)
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  } catch {
    return scanJsonlFiles(projectDir);
  }
}

/**
 * Fallback: scan directory for JSONL files when index is unavailable.
 */
function scanJsonlFiles(projectDir: string): SessionIndexEntry[] {
  const entries = readdirSync(projectDir, { withFileTypes: true });
  const sessions: SessionIndexEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const fullPath = join(projectDir, entry.name);
    const stat = statSync(fullPath);
    const sessionId = basename(entry.name, '.jsonl');

    sessions.push({
      sessionId,
      fullPath,
      fileMtime: stat.mtimeMs,
      firstPrompt: '',
      messageCount: 0,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      gitBranch: '',
      projectPath: '',
      isSidechain: false,
    });
  }

  return sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}

/**
 * Resolve session file path(s) by project name/path and optional session ID.
 *
 * @param projectNameOrPath - Encoded project name, original path, or partial match
 * @param sessionId - Optional specific session ID
 * @returns Array of { sessionPath, projectInfo, sessionEntry }
 */
export function resolveSessionPaths(
  projectNameOrPath?: string,
  sessionId?: string,
): { sessionPath: string; projectInfo: ProjectInfo; sessionEntry: SessionIndexEntry }[] {
  const projects = findProjects();
  const results: { sessionPath: string; projectInfo: ProjectInfo; sessionEntry: SessionIndexEntry }[] = [];

  // Filter projects by name/path if specified
  let matchedProjects = projects;
  if (projectNameOrPath) {
    matchedProjects = projects.filter((p) => {
      const normalizedQuery = projectNameOrPath.toLowerCase();
      return (
        p.encodedName.toLowerCase().includes(normalizedQuery) ||
        p.originalPath.toLowerCase().includes(normalizedQuery) ||
        basename(p.originalPath).toLowerCase().includes(normalizedQuery)
      );
    });
  }

  for (const project of matchedProjects) {
    const sessions = findSessions(project.projectDir);

    if (sessionId) {
      // Find specific session
      const session = sessions.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
      if (session) {
        const sessionPath = session.fullPath || join(project.projectDir, `${session.sessionId}.jsonl`);
        results.push({ sessionPath, projectInfo: project, sessionEntry: session });
      }
    } else {
      // All sessions for this project
      for (const session of sessions) {
        const sessionPath = session.fullPath || join(project.projectDir, `${session.sessionId}.jsonl`);
        results.push({ sessionPath, projectInfo: project, sessionEntry: session });
      }
    }
  }

  return results;
}
