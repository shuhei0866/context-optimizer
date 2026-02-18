import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function* streamJsonl<T>(filePath: string): AsyncGenerator<T> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as T;
    } catch {
      // Skip malformed lines
    }
  }
}
