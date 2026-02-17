import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), '.eval-cache');

let _hits = 0;
let _misses = 0;

export function cacheStats(): { hits: number; misses: number } {
  return { hits: _hits, misses: _misses };
}

export function resetCacheStats(): void {
  _hits = 0;
  _misses = 0;
}

interface CacheEntry<T> {
  key: string;
  timestamp: number;
  value: T;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(namespace: string, input: string): string {
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `${namespace}-${hash}`;
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

export function getCached<T>(namespace: string, input: string): T | null {
  const key = cacheKey(namespace, input);
  const path = cachePath(key);
  if (!existsSync(path)) {
    _misses++;
    return null;
  }
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry<T>;
    _hits++;
    return entry.value;
  } catch {
    _misses++;
    return null;
  }
}

export function setCache<T>(namespace: string, input: string, value: T): void {
  ensureCacheDir();
  const key = cacheKey(namespace, input);
  const entry: CacheEntry<T> = {
    key,
    timestamp: Date.now(),
    value,
  };
  writeFileSync(cachePath(key), JSON.stringify(entry, null, 2));
}
