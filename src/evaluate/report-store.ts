import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalReport } from './types.js';

const REPORTS_DIR = '.eval-reports';
const LATEST_FILE = 'latest.json';

function ensureDir(): string {
  const dir = join(process.cwd(), REPORTS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * Save an EvalReport to .eval-reports/ with a timestamped filename.
 * Also writes latest.json as a copy (not symlink, for Windows compatibility).
 * Returns the path of the timestamped file.
 */
export function saveReport(report: EvalReport): string {
  const dir = ensureDir();
  const timestamp = formatTimestamp(new Date());
  const filename = `${timestamp}.json`;
  const filepath = join(dir, filename);
  const json = JSON.stringify(report, null, 2);

  writeFileSync(filepath, json, 'utf-8');
  writeFileSync(join(dir, LATEST_FILE), json, 'utf-8');

  return filepath;
}

/**
 * Load the latest eval report from .eval-reports/latest.json.
 * Returns null if no report exists.
 */
export function loadLatestReport(): EvalReport | null {
  const latestPath = join(process.cwd(), REPORTS_DIR, LATEST_FILE);
  if (!existsSync(latestPath)) return null;

  const json = readFileSync(latestPath, 'utf-8');
  return JSON.parse(json) as EvalReport;
}

/**
 * Load a report from a specific path.
 */
export function loadReport(path: string): EvalReport {
  const json = readFileSync(path, 'utf-8');
  return JSON.parse(json) as EvalReport;
}

/**
 * List all saved reports, sorted by date descending (newest first).
 */
export function listReports(): { path: string; date: Date }[] {
  const dir = join(process.cwd(), REPORTS_DIR);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== LATEST_FILE)
    .map((f) => {
      // Parse timestamp from filename: 2026-02-19T12-34-56.json
      const stem = f.replace('.json', '').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
      return { path: join(dir, f), date: new Date(stem) };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
