import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { scanClaudeMdFiles } from '../claudemd/scanner.js';
import { parseSections } from '../claudemd/section-parser.js';
import { loadLatestReport, loadReport } from '../evaluate/report-store.js';
import { buildProposals, applyProposals } from '../evaluate/applier.js';
import type { ApplyProposal } from '../evaluate/applier.js';
import { formatPercent } from '../utils/format.js';

interface ApplyOptions {
  file?: string;
  reportPath?: string;
  maxViolation: number;
  yes: boolean;
  dryRun: boolean;
}

function parseArgs(args: string[]): ApplyOptions {
  const options: ApplyOptions = {
    maxViolation: 0.1,
    yes: false,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        options.file = args[++i];
        break;
      case '--report':
        options.reportPath = args[++i];
        break;
      case '--max-violation':
        options.maxViolation = parseFloat(args[++i]);
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }
  return options;
}

function printProposalDiff(proposal: ApplyProposal): void {
  const reduction = proposal.originalTokens > 0
    ? 1 - proposal.compressedTokens / proposal.originalTokens
    : 0;

  console.log(`\n--- ${proposal.sectionHeading} ---`);
  console.log(`  トークン: ${proposal.originalTokens} → ${proposal.compressedTokens} (${formatPercent(reduction)} 削減)`);
  console.log(`  違反率: ${formatPercent(proposal.violationRate)}`);
  console.log(`  判定一貫性: ${proposal.judgeAgreement.toFixed(2)}`);

  // 原文: 先頭3行 + ... + 末尾2行
  console.log(`  [原文]`);
  const origLines = proposal.originalText.split('\n').filter((l) => l.trim());
  if (origLines.length <= 5) {
    for (const line of origLines) {
      console.log(`    ${line}`);
    }
  } else {
    for (const line of origLines.slice(0, 3)) {
      console.log(`    ${line}`);
    }
    console.log(`    ...（${origLines.length - 5} 行省略）`);
    for (const line of origLines.slice(-2)) {
      console.log(`    ${line}`);
    }
  }

  // 圧縮版: 全文表示
  console.log(`  [圧縮版]`);
  for (const line of proposal.compressedText.split('\n')) {
    console.log(`    ${line}`);
  }
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export async function runApply(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // 1. レポート読み込み
  const report = options.reportPath
    ? loadReport(options.reportPath)
    : loadLatestReport();

  if (!report) {
    console.error('評価レポートが見つかりません。先に `evaluate --save` を実行してください。');
    process.exit(1);
  }

  // 2. 対象 CLAUDE.md を取得
  let targetPath: string;
  let targetContent: string;

  if (options.file) {
    targetPath = options.file;
    targetContent = readFileSync(targetPath, 'utf-8');
  } else {
    const files = scanClaudeMdFiles();
    const globalFile = files.find((f) => f.label.includes('グローバル') || f.label.includes('global'));
    if (!globalFile) {
      console.error('グローバル CLAUDE.md が見つかりません。--file で対象ファイルを指定してください。');
      process.exit(1);
    }
    targetPath = globalFile.path;
    targetContent = globalFile.content;
  }

  // 3. セクション解析 & 提案生成
  const sections = parseSections(targetContent);
  const proposals = buildProposals(sections, report.sections, options.maxViolation);

  if (proposals.length === 0) {
    console.log('適用可能な圧縮提案がありません（違反率が閾値を超えているか、セクションが一致しません）。');
    return;
  }

  // 4. diff 表示
  console.log(`=== 圧縮提案 (${proposals.length} セクション) ===`);
  console.log(`対象: ${targetPath}`);
  console.log(`最大違反率: ${formatPercent(options.maxViolation)}`);

  const totalOrigTokens = proposals.reduce((sum, p) => sum + p.originalTokens, 0);
  const totalCompTokens = proposals.reduce((sum, p) => sum + p.compressedTokens, 0);
  const totalReduction = totalOrigTokens - totalCompTokens;

  for (const proposal of proposals) {
    printProposalDiff(proposal);
  }

  console.log(`\n--- サマリー ---`);
  console.log(`適用対象: ${proposals.length} セクション`);
  console.log(`推定削減: ${totalReduction} トークン (${formatPercent(totalOrigTokens > 0 ? totalReduction / totalOrigTokens : 0)})`);

  // スキップされたセクションの情報
  const skipped = report.sections.filter(
    (s) => s.violationRate_compressed > options.maxViolation,
  );
  if (skipped.length > 0) {
    console.log(`スキップ: ${skipped.map((s) => `${s.sectionHeading} (違反率 ${formatPercent(s.violationRate_compressed)})`).join(', ')}`);
  }

  // 5. dry-run なら終了
  if (options.dryRun) {
    console.log('\n(dry-run モード: 適用されません)');
    return;
  }

  // 6. 確認
  if (!options.yes) {
    const ok = await confirm('\nこの変更を適用しますか？');
    if (!ok) {
      console.log('キャンセルしました。');
      return;
    }
  }

  // 7. バックアップ
  const backupPath = `${targetPath}.bak`;
  copyFileSync(targetPath, backupPath);
  console.error(`バックアップ: ${backupPath}`);

  // 8. 適用
  const newContent = applyProposals(targetContent, proposals);
  writeFileSync(targetPath, newContent, 'utf-8');

  console.log(`\n適用完了: ${targetPath}`);
  console.log(`  ${proposals.length} セクションを圧縮`);
  console.log(`  推定 ${totalReduction} トークン削減`);
  console.log(`  バックアップ: ${backupPath}`);
}
