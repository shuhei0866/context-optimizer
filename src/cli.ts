#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { selectVariants } from './core';
import type { OptimizedVariant, TaskSpec, VariantSpec } from './core';

type RecordLike = Record<string, unknown>;

type Status = 'ok' | 'fail';

interface RunRecord {
  taskId: string;
  runId: string;
  variantId?: string;
  inputTokens: number;
  outputTokens?: number;
  status: Status;
  requiredSkillUsed?: boolean;
  schemaValid?: boolean;
  qualityScore?: number;
}

type CsvRows = RecordLike[];

type Report = ReturnType<typeof selectVariants>;

interface OptimizationInputArgs {
  tasksPath: string;
  variantsPath: string;
  runsPath?: string;
  rawRunsPath?: string;
  budget: number;
  strictMode: boolean;
  qualityGate?: number;
  outputFormat: 'text' | 'json';
  deriveVariants: boolean;
  defaultEffort: number;
  qualityPassThreshold: number;
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => {
    if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') {
      return value.slice(1, -1);
    }
    return value;
  });
}

function parseCsvRows(filePath: string): CsvRows {
  const raw = readTextFile(filePath);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    return [];
  }

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  const rows = lines.slice(1);
  const result: CsvRows = [];

  for (const rowLine of rows) {
    const cols = parseCsvLine(rowLine);
    const record: RecordLike = {};
    for (let i = 0; i < header.length; i += 1) {
      record[header[i]] = cols[i] ?? '';
    }
    result.push(record);
  }

  return result;
}

function parseJsonRecords(filePath: string): RecordLike[] {
  const raw = readTextFile(filePath);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`JSON data must be an array: ${filePath}`);
  }
  return parsed as RecordLike[];
}

function parseRawRunRecords(filePath: string): RecordLike[] {
  const raw = readTextFile(filePath);
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (filePath.endsWith('.jsonl') || filePath.endsWith('.ndjson')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    const rows: RecordLike[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        throw new Error(`JSONL parse error at line ${index + 1}: ${message}`);
      }
    }
    return rows;
  }

  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) {
    return parsed as RecordLike[];
  }

  if (parsed && typeof parsed === 'object') {
    const container = parsed as Record<string, unknown>;
    const nested =
      pickFirstValue(container, ['runs', 'items', 'records', 'data', 'events', 'logs']) ??
      undefined;
    if (Array.isArray(nested)) {
      return nested as RecordLike[];
    }
  }

  throw new Error(`raw runs: JSON must be array or object with runs/items/records/data/events/logs: ${filePath}`);
}

function loadTable(filePath: string): RecordLike[] {
  if (!existsSync(filePath)) {
    throw new Error(`ファイルが見つかりません: ${filePath}`);
  }
  return filePath.endsWith('.json') || filePath.endsWith('.jsonl') || filePath.endsWith('.ndjson')
    ? parseJsonRecords(filePath)
    : parseCsvRows(filePath);
}

function pickFirstValue(row: RecordLike, keys: string[]): unknown {
  for (const key of keys) {
    const value = getFieldValue(row, key);
    if (value !== undefined && value !== null) {
      if (typeof value === 'string' && value.trim() === '') {
        continue;
      }
      return value;
    }
  }
  return undefined;
}

function getFieldValue(target: RecordLike, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = target;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as RecordLike)[part];
  }
  return current;
}

function firstField(row: RecordLike, keys: string[]): string {
  const value = pickFirstValue(row, keys);
  if (value === undefined || value === null) {
    return '';
  }
  return `${value}`.trim();
}

function parseNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"${field}" の数値変換に失敗しました: ${value}`);
  }
  return parsed;
}

function parseNumberValue(row: RecordLike, keys: string[], field: string, required = true): number {
  const value = pickFirstValue(row, keys);
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`"${field}" が見つかりません`);
    }
    return NaN;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`"${field}" の数値が不正です: ${value}`);
    }
    return value;
  }

  if (typeof value === 'string') {
    return parseNumber(value, field);
  }

  throw new Error(`"${field}" は数値形式ではありません: ${value}`);
}

function parseBool(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function parseBooleanValue(row: RecordLike, keys: string[], field: string, required = false): boolean | undefined {
  const value = pickFirstValue(row, keys);
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`"${field}" が見つかりません`);
    }
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
      return false;
    }
    if (normalized.length === 0) {
      return undefined;
    }
  }

  throw new Error(`"${field}" の真偽値変換に失敗しました: ${value}`);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`数値に変換できませんでした: ${value}`);
  }
  return parsed;
}

function parseQualityScore(raw: number, field = 'quality'): number {
  if (!Number.isFinite(raw)) {
    throw new Error(`"${field}" が不正な数値です: ${raw}`);
  }
  if (raw < 0) {
    return 0;
  }
  if (raw > 100) {
    return raw;
  }
  if (raw <= 1) {
    return raw * 100;
  }
  return raw;
}

function parseOptionalBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }
  throw new Error(`真偽値に変換できませんでした: ${value}`);
}

function parseRunStatus(row: RecordLike): Status {
  const raw = pickFirstValue(row, [
    'status',
    'result.status',
    'state',
    'ok',
    'success',
    'succeeded',
    'isSuccess',
    'is_success',
    'meta.status',
  ]);

  if (typeof raw === 'boolean') {
    return raw ? 'ok' : 'fail';
  }

  if (typeof raw === 'number') {
    return raw ? 'ok' : 'fail';
  }

  const text = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (['ok', 'success', 'succeeded', 'pass', 'passed', 'done', 'true', '1', 'yes', 'y'].includes(text)) {
    return 'ok';
  }
  if (['fail', 'failed', 'failure', 'error', 'denied', 'timeout', 'false', '0', 'no', 'n'].includes(text)) {
    return 'fail';
  }

  return 'ok';
}

function parseTaskRows(rows: RecordLike[], defaultQualityGate?: number): TaskSpec[] {
  return rows.map((row, idx) => {
    const taskId = firstField(row, ['taskId', 'task_id', 'id']);
    if (!taskId) {
      throw new Error(`tasks: ${idx + 1} 行目の taskId が空です`);
    }
    const name = firstField(row, ['name']) || taskId;
    const frequency = parseNumber(firstField(row, ['frequency']), `tasks[${taskId}].frequency`);
    const baselineTokens = parseNumber(
      firstField(row, ['baselineTokens', 'baseline_tokens', 'baseTokens']),
      `tasks[${taskId}].baselineTokens`,
    );
    const qualityGateRaw = firstField(row, ['qualityGate', 'quality_gate', 'qualityThreshold']);
    const qualityGate =
      qualityGateRaw !== ''
        ? parseNumber(qualityGateRaw, `tasks[${taskId}].qualityGate`)
        : defaultQualityGate ?? 0.95;

    return {
      taskId,
      name,
      frequency,
      baselineTokens,
      qualityGate,
    };
  });
}

function parseVariantRows(rows: RecordLike[]): VariantSpec[] {
  return rows.map((row, idx) => {
    const variantId = firstField(row, ['variantId', 'variant_id', 'id']);
    const taskId = firstField(row, ['taskId', 'task_id', 'task']);
    if (!variantId || !taskId) {
      throw new Error(`variants: ${idx + 1} 行目の variantId/taskId が空です`);
    }
    const name = firstField(row, ['name']) || variantId;
    return {
      variantId,
      taskId,
      name,
      reducedTokens: parseNumber(
        firstField(row, ['reducedTokens', 'reduced_tokens']),
        `variants[${variantId}].reducedTokens`,
      ),
      successRate: parseNumber(
        firstField(row, ['successRate', 'success_rate']),
        `variants[${variantId}].successRate`,
      ),
      violationRate: parseNumber(
        firstField(row, ['violationRate', 'violation_rate']),
        `variants[${variantId}].violationRate`,
      ),
      requiredEffort: parseNumber(
        firstField(row, ['requiredEffort', 'required_effort', 'effort']),
        `variants[${variantId}].requiredEffort`,
      ),
    };
  });
}

function parseRunRows(rows: RecordLike[]): RunRecord[] {
  return rows.map((row, idx) => {
    const taskId = firstField(row, ['taskId', 'task_id']);
    if (!taskId) {
      throw new Error(`runs: ${idx + 1} 行目の taskId が空です`);
    }

    const rawStatus = firstField(row, ['status']);
    const status = rawStatus === 'fail' ? 'fail' : 'ok';
    const runId = firstField(row, ['runId', 'run_id', 'id']) || `run-${idx + 1}`;
    const variantId = firstField(row, ['variantId', 'variant_id', 'variant']);

    const inputTokens = parseNumber(firstField(row, ['inputTokens', 'input_tokens', 'input']), `runs[${runId}].inputTokens`);
    const outputTokens = parseOptionalNumber(firstField(row, ['outputTokens', 'output_tokens', 'output']));
    const requiredSkillUsed = parseOptionalBool(firstField(row, ['requiredSkillUsed', 'required_skill_used', 'skillUsed']));
    const schemaValid = parseOptionalBool(firstField(row, ['schemaValid', 'schema_valid']));
    const qualityRaw = parseOptionalNumber(
      firstField(row, ['quality', 'qualityScore', 'quality_score']),
    );
    const qualityScore =
      qualityRaw === undefined
        ? undefined
        : parseQualityScore(qualityRaw, `runs[${runId}].quality`);

    return {
      taskId,
      runId,
      variantId: variantId || undefined,
      inputTokens,
      outputTokens,
      status,
      requiredSkillUsed,
      schemaValid,
      qualityScore,
    };
  });
}

function parseRawRunRows(rows: RecordLike[]): RunRecord[] {
  return rows.map((row, idx) => {
    const taskId = firstField(row, ['taskId', 'task_id', 'task.id', 'taskIdRef', 'task_name', 'task']);
    if (!taskId) {
      throw new Error(`raw runs: ${idx + 1} 行目の taskId が見つかりません`);
    }
    const runId =
      firstField(row, ['runId', 'run_id', 'id', 'traceId', 'meta.runId', 'executionId']) || `raw-run-${idx + 1}`;
    const variantId = firstField(row, ['variantId', 'variant_id', 'variant', 'candidateId', 'meta.variantId', 'meta.variant_id']);
    const status = parseRunStatus(row);
    const inputTokens = parseNumberValue(row, ['input_tokens', 'inputTokens', 'input', 'usage.input_tokens', 'usage.inputTokens', 'usage.prompt_tokens', 'metrics.inputTokens'], `runs[${runId}].inputTokens`);
    const outputTokensValue = parseNumberValue(
      row,
      ['output_tokens', 'outputTokens', 'output', 'usage.output_tokens', 'usage.outputTokens', 'usage.completion_tokens', 'metrics.outputTokens'],
      `runs[${runId}].outputTokens`,
      false,
    );
    const outputTokens = Number.isFinite(outputTokensValue) ? outputTokensValue : undefined;
    const requiredSkillUsed = parseBooleanValue(
      row,
      ['requiredSkillUsed', 'required_skill_used', 'toolCalls.discord.send_message.called', 'requiredSkill'],
      `runs[${runId}].requiredSkillUsed`,
    );
    const schemaValid = parseBooleanValue(
      row,
      ['schemaValid', 'schema_valid', 'meta.schemaValid', 'toolCalls.schemaValid', 'validation.valid'],
      `runs[${runId}].schemaValid`,
    );
    const qualityRaw = parseNumberValue(
      row,
      ['quality', 'qualityScore', 'quality_score', 'quality.score', 'metrics.quality'],
      `runs[${runId}].quality`,
      false,
    );
    const qualityScore =
      Number.isFinite(qualityRaw) ? parseQualityScore(qualityRaw, `runs[${runId}].quality`) : undefined;

    return {
      taskId,
      runId,
      variantId: variantId || undefined,
      inputTokens,
      outputTokens,
      status,
      requiredSkillUsed,
      schemaValid,
      qualityScore,
    };
  });
}

function overwriteTasksWithRuns(tasks: TaskSpec[], runs: RunRecord[], defaultQualityGate?: number): TaskSpec[] {
  const grouped = buildTaskStatsFromRuns(runs);
  return tasks.map((task) => {
    const stats = grouped.get(task.taskId);
    if (!stats) {
      return task;
    }
    return {
      ...task,
      frequency: stats.frequency,
      baselineTokens: stats.averageInputTokens,
      qualityGate: defaultQualityGate ?? task.qualityGate,
    };
  });
}

function buildTaskStatsFromRuns(runs: RunRecord[]): Map<string, { frequency: number; averageInputTokens: number }> {
  const grouped = new Map<string, { count: number; totalTokens: number }>();
  for (const run of runs) {
    const prev = grouped.get(run.taskId) ?? { count: 0, totalTokens: 0 };
    prev.count += 1;
    prev.totalTokens += run.inputTokens;
    grouped.set(run.taskId, prev);
  }
  const result = new Map<string, { frequency: number; averageInputTokens: number }>();
  for (const [taskId, value] of grouped) {
    result.set(taskId, {
      frequency: value.count,
      averageInputTokens: value.totalTokens / value.count,
    });
  }
  return result;
}

function deriveVariantsFromRuns(
  runs: RunRecord[],
  tasksById: Map<string, TaskSpec>,
  defaultEffort: number,
  qualityPassThreshold: number,
): VariantSpec[] {
  const grouped = new Map<string, { taskId: string; rows: RunRecord[] }>();

  for (const run of runs) {
    const variantKey = run.variantId;
    if (!variantKey) {
      continue;
    }
    const key = `${run.taskId}|${variantKey}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { taskId: run.taskId, rows: [run] });
      continue;
    }
    current.rows.push(run);
  }

  const derived: VariantSpec[] = [];

  for (const [key, value] of grouped) {
    const task = tasksById.get(value.taskId);
    if (!task || value.rows.length === 0) {
      continue;
    }

    const variantId = key.split('|').at(-1) || 'variant';
    const total = value.rows.length;
    const pass = value.rows.reduce((sum, row) => {
      const requiredSkillOk = row.requiredSkillUsed === undefined ? true : row.requiredSkillUsed;
      const schemaOk = row.schemaValid === undefined ? true : row.schemaValid;
      const qualityOk =
        row.qualityScore === undefined ? true : row.qualityScore >= qualityPassThreshold;
      const statusOk = row.status === 'ok';
      return sum + (statusOk && requiredSkillOk && schemaOk && qualityOk ? 1 : 0);
    }, 0);

    const success = value.rows.reduce((sum, row) => sum + (row.status === 'ok' ? 1 : 0), 0);
    const avgInput = value.rows.reduce((sum, row) => sum + row.inputTokens, 0) / total;
    const reducedTokens = Math.max(0, task.baselineTokens - avgInput);

    derived.push({
      variantId,
      taskId: value.taskId,
      name: `${value.taskId}::${variantId}`,
      reducedTokens,
      successRate: success / total,
      violationRate: 1 - pass / total,
      requiredEffort: defaultEffort,
    });
  }

  return derived;
}

function mergeVariantList(explicit: VariantSpec[], derived: VariantSpec[]): VariantSpec[] {
  const seen = new Set<string>(explicit.map((variant) => `${variant.taskId}|${variant.variantId}`));
  const result = explicit.slice();

  for (const variant of derived) {
    const key = `${variant.taskId}|${variant.variantId}`;
    if (!seen.has(key)) {
      result.push(variant);
      seen.add(key);
    }
  }

  return result;
}

function summarizeRuns(runs: RunRecord[]): string {
  if (runs.length === 0) {
    return '実行ログ: なし';
  }

  const byTask = new Map<string, { total: number; ok: number; sumQuality: number; withQuality: number }>();
  for (const run of runs) {
    const item = byTask.get(run.taskId) ?? { total: 0, ok: 0, sumQuality: 0, withQuality: 0 };
    item.total += 1;
    item.ok += run.status === 'ok' ? 1 : 0;
    if (run.qualityScore !== undefined) {
      item.sumQuality += run.qualityScore;
      item.withQuality += 1;
    }
    byTask.set(run.taskId, item);
  }

  return Array.from(byTask.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([taskId, value]) => {
      const successRate = Math.round((value.ok / value.total) * 1000) / 10;
      const avgQuality =
        value.withQuality > 0 ? Math.round((value.sumQuality / value.withQuality) * 10) / 10 : undefined;
      const avgQualityText = avgQuality === undefined ? 'n/a' : `${avgQuality}`;
      return `${taskId}: 実行 ${value.total} 回, 成功率 ${successRate}%, 平均品質 ${avgQualityText}`;
    })
    .join('\n');
}

function formatVariantScore(variant: OptimizedVariant): string {
  const name = variant.variantId ? variant.variantId : 'no-variant';
  return [
    variant.taskName,
    variant.taskId,
    `variant=${name}`,
    `score=${variant.score.toFixed(4)}`,
    `gain=${variant.expectedGain.toFixed(2)}`,
    `effort=${variant.expectedLoss}`,
  ].join(' | ');
}

function formatReport(report: Report, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];
  lines.push('=== 実験結果: Discord MCP ===');
  lines.push(`基準コンテキスト: ${report.baselineContext}`);
  lines.push(`推定コンテキスト: ${report.estimatedTotalContext}`);
  lines.push(`推定削減量: ${report.estimatedSavings}`);
  lines.push(`使用工数: ${report.usedEffort}`);
  lines.push('---');

  for (const item of report.selected) {
    const mark = item.variantId ? '採用' : '未採用';
    lines.push(`${mark} ${formatVariantScore(item)}`);
  }

  return lines.join('\n');
}

function printUsage(): void {
  console.log(`Usage:
  node dist/cli.js --tasks <path> --variants <path> [options]

Options:
  --tasks <path>                      TaskSpec CSV/JSON (default: data/tasks.csv)
  --variants <path>                   VariantSpec CSV/JSON (default: data/experiments.csv)
  --runs <path>                       実行ログ CSV/JSON (default: data/runs.csv)
  --raw-runs <path>                   raw ログ(JSON/JSONL) から runs を生成して最適化
  --budget <number>                   総工数予算 (default: 16)
  --qualityGate <num>                 全タスクの qualityGate 上書き
  --strict <true|false>               strictMode を上書き (default: true)
  --format <text|json>                出力形式 (default: text)
  --deriveVariants                    runs の variant_id 情報から品質/削減見込みを推定
  --defaultEffort <number>            deriveVariants の effort 既定値 (default: 1)
  --qualityPassThreshold <num>         そのままの品質スコア閾値 (0-100, default: 70)
  --help                              このヘルプ`);
}

function resolveArgs(): OptimizationInputArgs {
  const args = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      tasks: { type: 'string' },
      variants: { type: 'string' },
      runs: { type: 'string' },
      rawRuns: { type: 'string' },
      budget: { type: 'string' },
      qualityGate: { type: 'string' },
      strict: { type: 'string' },
      format: { type: 'string' },
      deriveVariants: { type: 'boolean' },
      defaultEffort: { type: 'string' },
      qualityPassThreshold: { type: 'string' },
      output: { type: 'string' },
    },
  });

  if (args.values.help) {
    printUsage();
    process.exit(0);
  }

  const tasksPath = (args.values.tasks as string | undefined) ?? 'data/tasks.csv';
  const variantsPath = (args.values.variants as string | undefined) ?? 'data/experiments.csv';
  const runsPath = args.values.runs as string | undefined;
  const rawRunsPath = args.values.rawRuns as string | undefined;
  if (!runsPath && !rawRunsPath) {
    throw new Error('run data が指定されていません。--runs または --raw-runs を指定してください。');
  }

  const budget = Number(args.values.budget ?? '16');
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error(`budget は 0 以上の数値で指定してください: ${args.values.budget}`);
  }

  const qualityGate = args.values.qualityGate !== undefined
    ? parseNumber(String(args.values.qualityGate), 'qualityGate')
    : undefined;
  const strictMode = parseBool(args.values.strict as string | undefined, true);
  const format = (args.values.format === 'json' ? 'json' : 'text') as 'text' | 'json';

  const deriveVariants = parseBool(args.values.deriveVariants as boolean | undefined, false);
  const defaultEffort = Number(args.values.defaultEffort ?? '1');
  if (!Number.isFinite(defaultEffort) || defaultEffort < 0) {
    throw new Error(`defaultEffort は 0 以上の数値で指定してください: ${args.values.defaultEffort}`);
  }

  const qualityPassThreshold = Number(args.values.qualityPassThreshold ?? '70');
  if (!Number.isFinite(qualityPassThreshold) || qualityPassThreshold < 0 || qualityPassThreshold > 100) {
    throw new Error(`qualityPassThreshold は 0〜100 の数値で指定してください: ${args.values.qualityPassThreshold}`);
  }

  return {
    tasksPath,
    variantsPath,
    runsPath,
    rawRunsPath,
    budget,
    strictMode,
    qualityGate,
    outputFormat: format,
    deriveVariants,
    defaultEffort,
    qualityPassThreshold,
  };
}

function main(): void {
  const opts = resolveArgs();

  const tasks = parseTaskRows(loadTable(opts.tasksPath), opts.qualityGate);
  const runs = opts.rawRunsPath ? parseRawRunRows(parseRawRunRecords(opts.rawRunsPath)) : parseRunRows(loadTable(opts.runsPath!));
  const effectiveTasks = overwriteTasksWithRuns(tasks, runs, opts.qualityGate);
  const taskMap = new Map<string, TaskSpec>(effectiveTasks.map((task) => [task.taskId, task]));

  const parsedVariants = parseVariantRows(loadTable(opts.variantsPath));
  const derivedVariants = opts.deriveVariants
    ? deriveVariantsFromRuns(runs, taskMap, opts.defaultEffort, opts.qualityPassThreshold)
    : [];
  const variants = mergeVariantList(parsedVariants, derivedVariants);

  const report = selectVariants({
    tasks: effectiveTasks,
    variants,
    budget: opts.budget,
    strictMode: opts.strictMode,
  });

  const summary = summarizeRuns(runs);
  const text = formatReport(report, opts.outputFormat);
  const header = [
    `tasks: ${opts.tasksPath}`,
    `variants: ${opts.variantsPath}`,
    `runs: ${opts.rawRunsPath ?? opts.runsPath}`,
    `budget: ${opts.budget}`,
    `strictMode: ${opts.strictMode}`,
  ];

  if (opts.deriveVariants) {
    header.push('deriveVariants: true');
    header.push(`derivedVariants: ${derivedVariants.length}`);
    header.push(`qualityPassThreshold: ${opts.qualityPassThreshold}`);
  }

  console.log(`# ${header.join(' | ')}`);
  console.log(summary);
  console.log('');
  console.log(text);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : `${error}`;
  console.error(`Error: ${message}`);
  process.exit(1);
}
