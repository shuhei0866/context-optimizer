import { homedir } from 'node:os';
import { join } from 'node:path';

export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

export function getProjectsDir(): string {
  return join(getClaudeDir(), 'projects');
}

export function encodeProjectPath(projectPath: string): string {
  // Claude Code encodes paths by replacing '/' with '-'
  return projectPath.replace(/\//g, '-');
}

export function decodeProjectPath(encoded: string): string {
  // Restore leading slash, the rest stays as-is (ambiguous, but first char is always -)
  if (encoded.startsWith('-')) {
    return '/' + encoded.slice(1).replace(/-/g, '/');
  }
  return encoded;
}
