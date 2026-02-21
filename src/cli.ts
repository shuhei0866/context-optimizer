#!/usr/bin/env node

import { runAnalyze } from './commands/analyze.js';
import { runClaudemd } from './commands/claudemd.js';
import { runInsights } from './commands/insights.js';
import { runEvaluate } from './commands/evaluate.js';
import { runApply } from './commands/apply.js';
import { runDiagnose } from './commands/diagnose.js';
import { runAgents } from './commands/agents.js';

const VERSION = '0.3.0';

function printUsage(): void {
  console.log(`context-optimizer v${VERSION}
Claude Code セッション分析 & コンテキスト最適化ツール

使い方:
  context-optimizer <command> [options]

コマンド:
  analyze    セッションのトークン消費を分析
  claudemd   CLAUDE.md のトークンコスト分析 & 最適化提案
  evaluate   CLAUDE.md 圧縮品質を LLM-as-judge で評価
  apply      評価結果の圧縮テキストを CLAUDE.md に反映
  insights   プロジェクト横断のトークン効率分析
  diagnose   コンテキスト消費の診断（探索ホットスポット・重複検出）
  agents     AGENTS.md の管理（scan / generate）

analyze オプション:
  --session <id>         特定セッションを分析
  --project <name|path>  プロジェクト内のセッションを分析
  --all                  全プロジェクト横断
  --last                 最新セッションのみ（デフォルト）
  --per-turn             ターン別内訳を表示
  --format text|json     出力形式（デフォルト: text）
  --export <path>        セッション集計を CSV にエクスポート

claudemd オプション:
  --format text|json     出力形式（デフォルト: text）

evaluate オプション:
  --section <name>       特定セクションのみ評価
  --trials <n>           テスト試行数（デフォルト: 4）
  --judge-model <model>  判定モデル（デフォルト: claude-haiku-4-5-20251001）
  --subject-model <model> 被験者モデル（デフォルト: claude-haiku-4-5-20251001）
  --format text|json     出力形式（デフォルト: text）
  --save                 評価結果をレポートファイルに保存
  --dry-run              API 呼び出しなしでテストケースのみ表示

apply オプション:
  --file <path>          対象 CLAUDE.md（デフォルト: グローバル）
  --report <path>        レポートファイル（デフォルト: latest.json）
  --max-violation <rate> 許容する最大違反率（デフォルト: 0.1）
  --yes                  確認なしで適用
  --dry-run              diff 表示のみ、適用しない

insights オプション:
  --project <name|path>  特定プロジェクトのみ
  --all                  全プロジェクト横断（デフォルト）
  --limit <n>            分析セッション数上限（デフォルト: 50）
  --format text|json     出力形式（デフォルト: text）

diagnose オプション:
  --project <name|path>  対象プロジェクト（必須）
  --limit <n>            分析セッション数（デフォルト: 30）
  --format text|json     出力形式（デフォルト: text）

agents サブコマンド:
  agents scan <project-path>      AGENTS.md の有無をスキャン
    --min-files <n>               最小ファイル数（デフォルト: 3）
    --depth <n>                   スキャン深度（デフォルト: 4）
    --format text|json            出力形式（デフォルト: text）
  agents generate <directory>     AGENTS.md スケルトンを生成
    --output <path>               出力先（デフォルト: stdout）
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
    case 'apply':
      await runApply(process.argv.slice(3));
      break;
    case 'insights':
      await runInsights(process.argv.slice(3));
      break;
    case 'diagnose':
      await runDiagnose(process.argv.slice(3));
      break;
    case 'agents':
      await runAgents(process.argv.slice(3));
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
