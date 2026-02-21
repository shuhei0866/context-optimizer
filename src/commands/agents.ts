import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative, extname } from 'node:path';
import { padRight, padLeft } from '../utils/format.js';

interface AgentsScanOptions {
  minFiles: number;
  depth: number;
  format: 'text' | 'json';
}

interface AgentsGenerateOptions {
  output?: string;
}

interface DirectoryInfo {
  path: string;
  relativePath: string;
  fileCount: number;
  hasAgentsMd: boolean;
  codeFiles: string[];
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.vue', '.svelte',
]);

function parseScanArgs(args: string[]): { projectPath: string; options: AgentsScanOptions } {
  const options: AgentsScanOptions = {
    minFiles: 3,
    depth: 4,
    format: 'text',
  };

  let projectPath = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--min-files':
        options.minFiles = parseInt(args[++i], 10) || 3;
        break;
      case '--depth':
        options.depth = parseInt(args[++i], 10) || 4;
        break;
      case '--format':
        options.format = args[++i] as 'text' | 'json';
        break;
      default:
        if (!args[i].startsWith('-') && !projectPath) {
          projectPath = args[i];
        }
    }
  }

  return { projectPath, options };
}

function parseGenerateArgs(args: string[]): { directory: string; options: AgentsGenerateOptions } {
  const options: AgentsGenerateOptions = {};
  let directory = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        options.output = args[++i];
        break;
      default:
        if (!args[i].startsWith('-') && !directory) {
          directory = args[i];
        }
    }
  }

  return { directory, options };
}

/**
 * Recursively scan directories for code files.
 */
function scanDirectories(
  rootPath: string,
  currentPath: string,
  maxDepth: number,
  currentDepth: number,
): DirectoryInfo[] {
  if (currentDepth > maxDepth) return [];

  const results: DirectoryInfo[] = [];

  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = readdirSync(currentPath, { withFileTypes: true, encoding: 'utf-8' });
  } catch {
    return [];
  }

  const codeFiles: string[] = [];
  const subdirs: string[] = [];
  const skipDirs = new Set(['node_modules', 'dist', 'build', '__pycache__', '.next', 'coverage', 'vendor']);

  for (const entry of entries) {
    // Skip hidden dirs and common non-code dirs
    if (entry.name.startsWith('.')) continue;
    if (skipDirs.has(entry.name)) continue;

    if (entry.isDirectory()) {
      subdirs.push(join(currentPath, entry.name));
    } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
      codeFiles.push(entry.name);
    }
  }

  if (codeFiles.length > 0) {
    results.push({
      path: currentPath,
      relativePath: relative(rootPath, currentPath) || '.',
      fileCount: codeFiles.length,
      hasAgentsMd: existsSync(join(currentPath, 'AGENTS.md')),
      codeFiles,
    });
  }

  for (const subdir of subdirs) {
    results.push(...scanDirectories(rootPath, subdir, maxDepth, currentDepth + 1));
  }

  return results;
}

async function runScan(args: string[]): Promise<void> {
  const { projectPath, options } = parseScanArgs(args);

  if (!projectPath) {
    console.error('エラー: プロジェクトパスを指定してください。');
    console.error('使い方: context-optimizer agents scan <project-path>');
    process.exit(1);
  }

  if (!existsSync(projectPath)) {
    console.error(`エラー: パスが存在しません: ${projectPath}`);
    process.exit(1);
  }

  const dirs = scanDirectories(projectPath, projectPath, options.depth, 0);

  if (options.format === 'json') {
    console.log(JSON.stringify(dirs, null, 2));
    return;
  }

  const withAgents = dirs.filter((d) => d.hasAgentsMd);
  const withoutAgentsRecommended = dirs.filter(
    (d) => !d.hasAgentsMd && d.fileCount >= options.minFiles,
  );
  const withoutAgentsOptional = dirs.filter(
    (d) => !d.hasAgentsMd && d.fileCount < options.minFiles && d.fileCount > 0,
  );

  console.log(`=== AGENTS.md スキャン: ${projectPath} ===\n`);

  if (withAgents.length > 0) {
    console.log('AGENTS.md あり:');
    for (const d of withAgents) {
      console.log(`  ✓ ${padRight(d.relativePath, 40)} (${d.fileCount} files)`);
    }
    console.log('');
  }

  if (withoutAgentsRecommended.length > 0) {
    console.log('AGENTS.md なし（推奨）:');
    const sorted = withoutAgentsRecommended.sort((a, b) => b.fileCount - a.fileCount);
    for (const d of sorted) {
      console.log(`  ⚠ ${padRight(d.relativePath, 40)} (${d.fileCount} files)`);
    }
    console.log('');
  }

  if (withoutAgentsOptional.length > 0) {
    console.log('AGENTS.md なし（任意）:');
    for (const d of withoutAgentsOptional) {
      console.log(`  · ${padRight(d.relativePath, 40)} (${d.fileCount} files)`);
    }
    console.log('');
  }

  // Summary
  const total = dirs.length;
  const covered = withAgents.length;
  console.log(`合計: ${total} ディレクトリ, AGENTS.md カバレッジ: ${covered}/${total}`);
}

async function runGenerate(args: string[]): Promise<void> {
  const { directory, options } = parseGenerateArgs(args);

  if (!directory) {
    console.error('エラー: ディレクトリを指定してください。');
    console.error('使い方: context-optimizer agents generate <directory>');
    process.exit(1);
  }

  if (!existsSync(directory)) {
    console.error(`エラー: ディレクトリが存在しません: ${directory}`);
    process.exit(1);
  }

  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf-8' });
  } catch (err) {
    console.error(`エラー: ディレクトリの読み取りに失敗: ${err}`);
    process.exit(1);
  }

  const codeFiles: string[] = [];
  const testFiles: string[] = [];
  const otherFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;

    const ext = extname(entry.name);
    if (!CODE_EXTENSIONS.has(ext)) {
      otherFiles.push(entry.name);
      continue;
    }

    if (isTestFile(entry.name)) {
      testFiles.push(entry.name);
    } else {
      codeFiles.push(entry.name);
    }
  }

  const dirName = basename(directory);
  const relativePath = directory;

  // Generate skeleton
  const lines: string[] = [];
  lines.push(`# ${relativePath} — TODO: ドメイン説明`);
  lines.push('');

  if (codeFiles.length > 0) {
    lines.push('| ファイル | 責務 |');
    lines.push('|---------|------|');

    for (const file of codeFiles.sort()) {
      const category = categorizeFile(file);
      const description = category ? `TODO: ${category}` : 'TODO: 説明を記入';
      lines.push(`| ${file} | ${description} |`);
    }
    lines.push('');
  }

  if (testFiles.length > 0) {
    lines.push('## テスト');
    if (testFiles.every((f) => codeFiles.some((c) => f.includes(basename(c, extname(c)))))) {
      lines.push('各モジュールに `*.test.*` が併置。');
    } else {
      for (const file of testFiles.sort()) {
        lines.push(`- ${file}`);
      }
    }
    lines.push('');
  }

  if (otherFiles.length > 0) {
    const configFiles = otherFiles.filter((f) =>
      ['json', 'yaml', 'yml', 'toml', 'env'].some((ext) => f.endsWith(`.${ext}`)),
    );
    if (configFiles.length > 0) {
      lines.push('## 設定ファイル');
      for (const file of configFiles.sort()) {
        lines.push(`- ${file}`);
      }
      lines.push('');
    }
  }

  const output = lines.join('\n');

  if (options.output) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(options.output, output, 'utf-8');
    console.error(`出力: ${options.output}`);
  } else {
    console.log(output);
  }
}

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.[^.]+$/.test(name) || name.startsWith('test_') || name.endsWith('_test.go');
}

function categorizeFile(name: string): string | null {
  if (name === 'route.ts' || name === 'route.tsx') return 'API Route';
  if (name === 'page.tsx' || name === 'page.ts') return 'ページコンポーネント';
  if (name === 'layout.tsx' || name === 'layout.ts') return 'レイアウト';
  if (name === 'loading.tsx') return 'ローディング UI';
  if (name === 'error.tsx') return 'エラーバウンダリ';
  if (name.includes('schema')) return 'バリデーションスキーマ';
  if (name.includes('types') || name.endsWith('.d.ts')) return '型定義';
  if (name.includes('utils') || name.includes('helpers')) return 'ユーティリティ';
  if (name.includes('hook') || name.startsWith('use')) return 'カスタムフック';
  if (name.includes('context')) return 'React Context';
  if (name.includes('middleware')) return 'ミドルウェア';
  if (name.includes('action')) return 'Server Action';
  return null;
}

export async function runAgents(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'scan':
      await runScan(args.slice(1));
      break;
    case 'generate':
      await runGenerate(args.slice(1));
      break;
    default:
      console.error('使い方:');
      console.error('  context-optimizer agents scan <project-path> [options]');
      console.error('  context-optimizer agents generate <directory> [options]');
      if (subcommand) {
        console.error(`\n不明なサブコマンド: ${subcommand}`);
      }
      process.exit(1);
  }
}
