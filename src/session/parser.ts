import { dirname } from 'node:path';
import type {
  JsonlRecord,
  AssistantMessage,
  TurnData,
  ToolUseSummary,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  CostBreakdown,
  FileAccess,
} from './types.js';
import { calculateTurnCost } from '../analyzer/cost-calculator.js';
import { streamJsonl } from '../utils/streaming.js';

interface ParsedAssistantMsg {
  messageId: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  toolUseBlocks: ToolUseBlock[];
  stopReason: string | null;
  cost: CostBreakdown;
}

interface ParsedToolResult {
  toolUseId: string;
  toolName?: string;
  resultSize: number;
}

export interface ParseSessionOptions {
  includeFileAccess?: boolean;
}

/**
 * Extract file access info from a tool_use block.
 */
function extractFileAccess(
  toolName: string,
  input: Record<string, unknown>,
  resultSize: number,
): FileAccess | null {
  let filePath: string | undefined;
  let operation: FileAccess['operation'];

  switch (toolName) {
    case 'Read':
      filePath = input.file_path as string;
      operation = 'read';
      break;
    case 'Write':
      filePath = input.file_path as string;
      operation = 'write';
      break;
    case 'Edit':
      filePath = input.file_path as string;
      operation = 'edit';
      break;
    case 'Glob':
      filePath = input.path as string;
      operation = 'glob';
      break;
    case 'Grep':
      filePath = input.path as string;
      operation = 'grep';
      break;
    default:
      return null;
  }

  if (!filePath) return null;
  return { filePath, directory: dirname(filePath), operation, resultSize };
}

/**
 * Parse a session JSONL file into TurnData[].
 *
 * Key implementation details:
 * - Assistant messages appear as multiple streaming chunks with the same message.id
 * - We keep only the last chunk per message.id (it has the correct cumulative usage)
 * - Turn boundaries are marked by system/turn_duration messages
 * - Sidechain messages (subagent) are skipped
 */
export async function parseSession(filePath: string, options?: ParseSessionOptions): Promise<{
  turns: TurnData[];
  sessionId: string;
  projectPath: string;
  gitBranch: string;
  firstPrompt: string;
  durationMs: number;
}> {
  // Collect all records, deduplicating assistant messages by message.id
  const assistantMsgs = new Map<string, ParsedAssistantMsg>();
  const toolResults: ParsedToolResult[] = [];
  const turnDurations: { timestamp: string; durationMs: number }[] = [];
  // Map from tool_use id to tool name
  const toolUseNames = new Map<string, string>();
  // Map from tool_use id to tool input (for file access extraction)
  const toolUseInputs = new Map<string, { name: string; input: Record<string, unknown> }>();
  const includeFileAccess = options?.includeFileAccess ?? false;

  let sessionId = '';
  let projectPath = '';
  let gitBranch = '';
  let firstPrompt = '';
  let totalDurationMs = 0;

  for await (const record of streamJsonl<JsonlRecord>(filePath)) {
    // Skip sidechain (subagent) messages
    if (record.isSidechain) continue;

    if (!sessionId && record.sessionId) sessionId = record.sessionId;
    if (!gitBranch && record.gitBranch) gitBranch = record.gitBranch;

    if (record.type === 'user' && record.message && 'role' in record.message && record.message.role === 'user') {
      // Capture first user prompt
      if (!firstPrompt) {
        const content = record.message.content;
        if (typeof content === 'string') {
          firstPrompt = content.slice(0, 200);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if ('text' in block && block.type === 'text') {
              firstPrompt = block.text.slice(0, 200);
              break;
            }
          }
        }
      }

      // Collect tool_result blocks from user messages
      if (Array.isArray(record.message.content)) {
        for (const block of record.message.content as ContentBlock[]) {
          if ('type' in block && block.type === 'tool_result') {
            const tr = block as ToolResultBlock;
            const resultSize = typeof tr.content === 'string' ? tr.content.length : 0;
            toolResults.push({
              toolUseId: tr.tool_use_id,
              toolName: toolUseNames.get(tr.tool_use_id),
              resultSize,
            });
          }
        }
      }
    }

    if (record.type === 'assistant' && record.message && 'model' in record.message) {
      const msg = record.message as AssistantMessage;
      const usage = msg.usage;
      if (!usage) continue;

      // Collect tool_use blocks for name mapping
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolUseNames.set(block.id, block.name);
            if (includeFileAccess) {
              toolUseInputs.set(block.id, { name: block.name, input: block.input });
            }
          }
        }
      }

      // Deduplicate by message.id — keep the latest (last) chunk
      const parsed: ParsedAssistantMsg = {
        messageId: msg.id,
        model: msg.model,
        timestamp: record.timestamp,
        inputTokens: usage.input_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        toolUseBlocks: (msg.content || []).filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        ),
        stopReason: msg.stop_reason,
        cost: calculateTurnCost(msg.model, {
          input_tokens: usage.input_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
        }),
      };
      assistantMsgs.set(msg.id, parsed);
    }

    if (record.type === 'system' && record.subtype === 'turn_duration') {
      turnDurations.push({
        timestamp: record.timestamp,
        durationMs: record.durationMs || 0,
      });
      totalDurationMs += record.durationMs || 0;
    }
  }

  // Resolve tool result names from the tool use map
  for (const tr of toolResults) {
    if (!tr.toolName) {
      tr.toolName = toolUseNames.get(tr.toolUseId);
    }
  }

  // Build turns from deduplicated assistant messages
  // Order by timestamp
  const orderedMsgs = [...assistantMsgs.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Build tool result size index (toolUseId -> resultSize)
  const toolResultIndex = new Map<string, { name: string; size: number }>();
  for (const tr of toolResults) {
    if (tr.toolName) {
      toolResultIndex.set(tr.toolUseId, { name: tr.toolName, size: tr.resultSize });
    }
  }

  const turns: TurnData[] = [];
  const modelsUsed = new Set<string>();

  for (let i = 0; i < orderedMsgs.length; i++) {
    const msg = orderedMsgs[i];
    modelsUsed.add(msg.model);

    const totalInput = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
    const cacheHitRatio = totalInput > 0 ? msg.cacheReadTokens / totalInput : 0;

    // Aggregate tool uses for this message
    const toolMap = new Map<string, { callCount: number; totalResultSize: number }>();
    const turnFileAccesses: FileAccess[] = [];
    for (const tu of msg.toolUseBlocks) {
      const info = toolResultIndex.get(tu.id);
      const name = tu.name;
      const existing = toolMap.get(name) || { callCount: 0, totalResultSize: 0 };
      existing.callCount++;
      if (info) {
        existing.totalResultSize += info.size;
      }
      toolMap.set(name, existing);

      // Extract file access if enabled
      if (includeFileAccess) {
        const tuInput = toolUseInputs.get(tu.id);
        if (tuInput) {
          const resultSize = info?.size ?? 0;
          const fa = extractFileAccess(tuInput.name, tuInput.input, resultSize);
          if (fa) turnFileAccesses.push(fa);
        }
      }
    }

    const toolUses: ToolUseSummary[] = [...toolMap.entries()].map(([toolName, data]) => ({
      toolName,
      callCount: data.callCount,
      totalResultSize: data.totalResultSize,
    }));

    // Match turn duration
    const turnDuration = turnDurations[i];

    turns.push({
      turnIndex: i,
      timestamp: msg.timestamp,
      model: msg.model,
      inputTokens: msg.inputTokens,
      cacheCreationTokens: msg.cacheCreationTokens,
      cacheReadTokens: msg.cacheReadTokens,
      outputTokens: msg.outputTokens,
      totalInputTokens: totalInput,
      cacheHitRatio,
      toolUses,
      ...(includeFileAccess && turnFileAccesses.length > 0 ? { fileAccesses: turnFileAccesses } : {}),
      durationMs: turnDuration?.durationMs,
      estimatedCost: msg.cost,
    });
  }

  // Extract projectPath from session file path or cwd
  if (!projectPath) {
    // Will be set by reader
  }

  return {
    turns,
    sessionId,
    projectPath,
    gitBranch,
    firstPrompt,
    durationMs: totalDurationMs,
  };
}
