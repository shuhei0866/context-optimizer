import type { SessionSummary } from '../session/types.js';

export function formatSessionJson(summary: SessionSummary): string {
  return JSON.stringify(summary, null, 2);
}
