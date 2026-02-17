export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ApiResponse {
  content: string;
  usage: { input_tokens: number; output_tokens: number };
}

export function getApiKey(): string {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY 環境変数が設定されていません。\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...',
    );
  }
  return key;
}

const MAX_RETRIES = 3;
const RETRYABLE_STATUS = [429, 529, 500, 502, 503];

export async function callClaude(options: {
  model: string;
  system?: string;
  messages: ApiMessage[];
  maxTokens: number;
}): Promise<ApiResponse> {
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens,
    messages: options.messages,
  };
  if (options.system) {
    body.system = options.system;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
      await new Promise((r) => setTimeout(r, delay));
    }

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network errors (ETIMEDOUT, ECONNRESET, etc.)
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) continue;
      throw lastError;
    }

    if (res.ok) {
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };
      const textBlock = data.content.find((b) => b.type === 'text');
      return {
        content: textBlock?.text ?? '',
        usage: data.usage,
      };
    }

    if (RETRYABLE_STATUS.includes(res.status) && attempt < MAX_RETRIES) {
      continue;
    }

    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text}`);
  }

  throw lastError ?? new Error('Unreachable');
}
