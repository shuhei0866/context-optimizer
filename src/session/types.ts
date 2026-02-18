// Token usage from Anthropic API response
export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  server_tool_use?: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
}

// Tool use summary per turn
export interface ToolUseSummary {
  toolName: string;
  callCount: number;
  totalResultSize: number; // approximate characters in tool_result
}

// Subagent usage in a turn
export interface SubagentUsage {
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// Cost breakdown in USD
export interface CostBreakdown {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  total: number;
}

// Per-turn analysis
export interface TurnData {
  turnIndex: number;
  timestamp: string;
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalInputTokens: number; // input + creation + read
  cacheHitRatio: number; // read / totalInput
  toolUses: ToolUseSummary[];
  durationMs?: number;
  estimatedCost: CostBreakdown;
}

// Tool ranking entry
export interface ToolRankingEntry {
  toolName: string;
  callCount: number;
  averageResultSize: number;
  totalResultSize: number;
}

// Cache efficiency data
export interface CacheEfficiencyData {
  overallHitRatio: number;
  turnHitRatios: number[];
  totalCacheCreation: number;
  totalCacheRead: number;
}

// Session summary
export interface SessionSummary {
  sessionId: string;
  projectPath: string;
  gitBranch: string;
  firstPrompt: string;
  turnCount: number;
  totalTokens: {
    input: number;
    cacheCreation: number;
    cacheRead: number;
    output: number;
    total: number;
  };
  totalCost: CostBreakdown;
  toolRanking: ToolRankingEntry[];
  overallCacheHitRatio: number;
  modelsUsed: string[];
  durationMs: number;
  turns?: TurnData[];
}

// JSONL message record (top-level fields)
export interface JsonlRecord {
  type: string;
  subtype?: string;
  parentUuid: string | null;
  isSidechain: boolean;
  sessionId: string;
  uuid: string;
  timestamp: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  requestId?: string;
  message?: AssistantMessage | UserMessage;
  durationMs?: number;
  data?: ProgressData;
}

export interface AssistantMessage {
  model: string;
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  stop_reason: string | null;
  usage: TokenUsage;
}

export interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface ProgressData {
  type: string;
  agentId?: string;
  message?: {
    type: string;
    message: AssistantMessage | UserMessage;
  };
}

// Session index types
export interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

export interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
  originalPath: string;
}

export interface ProjectInfo {
  encodedName: string;
  originalPath: string;
  projectDir: string;
}
