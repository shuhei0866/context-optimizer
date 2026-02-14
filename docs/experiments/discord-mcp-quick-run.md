# Discord MCP クイック実験レポート（第1回）

**実施日**: 2026-02-14  
**目的**: Discord MCP で、短いサンプルデータを使って `context-optimizer` の選定ロジック（`deriveVariants` + `strictMode` + 予算制約）を実データで1回回す。

## 入力データ

- タスク定義: `examples/discord-mcp/samples/quick-tasks.csv`
- 候補バリアント: `examples/discord-mcp/samples/quick-variants.csv`
- 実行ログ（raw形式）: `examples/discord-mcp/samples/quick-runs.json`

### データの意味

- `quick-tasks.csv`（設計時情報）
  - `taskId`: タスク識別子（同一タスクを実験・集計で突合するキー）
  - `name`: レポートや表示名
  - `frequency`: 観測窓あたりの想定呼び出し回数（本実験では `discord-review-1` が 120、`discord-ack-1` が 40）
  - `baselineTokens`: 改善前1回あたりの想定消費トークン
  - `qualityGate`: そのタスクの許容品質閾値（現行実装では主に `strictMode` 時のバリアント除外に利用）
- `quick-variants.csv`（候補評価データ）
  - `variantId`: 改善案ID（提案する施策そのもの）
  - `reducedTokens`: 1回あたりのトークン削減見込み
  - `successRate`: 提案導入時に成功した比率（0〜1）
  - `violationRate`: 品質違反率（0〜1）
  - `requiredEffort`: 実装コスト（予算制約の単位）
- `quick-runs.json`（観測ログ）
  - `taskId`: 実行対象タスク
  - `variantId`: 実行時に使われたバリアント（`deriveVariants` がここからバリアントの成功率等を再推定）
  - `status`: 実行成否（`ok`/`fail`）
  - `requiredSkillUsed`: 必須スキルの実行有無（`strictMode` 配下で安全性判定に寄与）
  - `schemaValid`: スキーマ適合フラグ（品質下限の一部）
  - `quality`: 品質スコア（0〜100）

## 実行コマンド

```bash
cd /Users/snufkin/Developer/github/context-optimizer
npm run build
node dist/cli.js \
  --tasks examples/discord-mcp/samples/quick-tasks.csv \
  --variants examples/discord-mcp/samples/quick-variants.csv \
  --runs examples/discord-mcp/samples/quick-runs.json \
  --deriveVariants \
  --budget 16 \
  --strict true \
  --format text
```

## 実行結果（標準出力）

```text
# tasks: examples/discord-mcp/samples/quick-tasks.csv | variants: examples/discord-mcp/samples/quick-variants.csv | runs: examples/discord-mcp/samples/quick-runs.json | budget: 16 | strictMode: true | deriveVariants: true | derivedVariants: 2 | qualityPassThreshold: 70
discord-ack-1: 実行 1 回, 成功率 100%, 平均品質 96
discord-review-1: 実行 2 回, 成功率 100%, 平均品質 92.5

=== 実験結果: Discord MCP ===
基準コンテキスト: 1098
推定コンテキスト: 888.525
推定削減量: 209.47500000000002
使用工数: 13
---
採用 discord-review | discord-review-1 | variant=compact-1 | score=10.3635 | gain=165.82 | effort=8
採用 discord-acknowledge | discord-ack-1 | variant=compact-ack | score=8.7318 | gain=43.66 | effort=5
```

## サマリ

- `qualityPassThreshold=70`、`strictMode=true` の下で、両タスクとも品質制約を満たしたため採用対象になった。
- 予算 `16` の制約下で、`compact-1`（レビュー）と `compact-ack`（ack）を採用し、合計工数 `13` を消費。
- 1回あたり削減と頻度を掛けた推定削減の合計で、実行後コンテキストを `1098 -> 888.525` に圧縮（削減率ベースで約19.06%相当）。

## メモ

- `deriveVariants` により、`quick-runs.json` からバリアント別成功率・品質・削減推定を自動生成した。
- `data/runs.csv` はヘッダー行が `#` で注釈扱いされる形式だったため、サンプル実験では raw JSON を使った。
- 実運用では、`quick-*` のデータを実データへ置換して再実行することで、同じレポートフォーマットで比較実験を継続できる。
