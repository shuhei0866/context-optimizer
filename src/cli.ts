#!/usr/bin/env node

import { runAnalyze } from './commands/analyze.js';
import { runClaudemd } from './commands/claudemd.js';
import { runInsights } from './commands/insights.js';
import { runEvaluate } from './commands/evaluate.js';

const VERSION = '0.2.0';

function printUsage(): void {
  console.log(`context-optimizer v${VERSION}
Claude Code セッション分析 & コンテキスト最適化ツール

使い方:
  context-optimizer <command> [options]

コマンド:
  analyze    セッションのトークン消費を分析
  claudemd   CLAUDE.md のトークンコスト分析 & 最適化提案
  evaluate   CLAUDE.md 圧縮品質を LLM-as-judge で評価
  insights   プロジェクト横断のトークン効率分析

analyze オプション:
  --session <id>         特定セッションを分析
  --project <name|path>  プロジェクト内のセッションを分析
  --all                  全プロジェクト横断
  --last                 最新セッションのみ（デフォルト）
  --per-turn             ターン別内訳を表示
  --format text|json     出力形式（デフォルト: text）

claudemd オプション:
  --format text|json     出力形式（デフォルト: text）

evaluate オプション:
  --section <name>       特定セクションのみ評価
  --trials <n>           テスト試行数（デフォルト: 4）
  --judge-model <model>  判定モデル（デフォルト: claude-haiku-4-5-20251001）
  --subject-model <model> 被験者モデル（デフォルト: claude-haiku-4-5-20251001）
  --format text|json     出力形式（デフォルト: text）
  --dry-run              API 呼び出しなしでテストケースのみ表示

insights オプション:
  --project <name|path>  特定プロジェクトのみ
  --all                  全プロジェクト横断（デフォルト）
  --limit <n>            分析セッション数上限（デフォルト: 50）
  --format text|json     出力形式（デフォルト: text）
`);
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];

  switch (subcommand) {
    case 'analyze':
      await runAnalyze(process.argv.slice(3));
      break;
    case 'claudemd':
      await runClaudemd(process.argv.slice(3));
      break;
    case 'evaluate':
      await runEvaluate(process.argv.slice(3));
      break;
    case 'insights':
      await runInsights(process.argv.slice(3));
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`不明なコマンド: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('致命的なエラー:', err);
  process.exit(1);
});
