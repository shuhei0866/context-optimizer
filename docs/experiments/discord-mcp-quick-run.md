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
  - `description`: バリアントの差分意図（本実験では実プロンプト差分ではなく、施策の短縮設計意図を定義）
  - `reducedTokens`: 1回あたりのトークン削減見込み
  - `successRate`: 提案導入時に成功した比率（0〜1）
  - `violationRate`: 品質違反率（0〜1）
  - `requiredEffort`: 実装コスト（予算制約の単位）
  - 本実験におけるバリアント:
    - `compact-1`: レビュー文面の装飾削減、要点中心化
    - `compact-2`: フォーマットの超短縮（効果大・副作用リスク高）
    - `compact-ack`: ACK 文の固定表現を短縮し、最小構造の返却を目指す
  - 実データ実験では `description` ではなく、`promptBefore` / `promptAfter` のような実差分を持つ列を追加し、実測トークン差分で `reducedTokens` を埋めるのが望ましい
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

## 実験時に与えたDiscord MCP向けの具体指示

この実験は `examples/discord-mcp/prompt-template.md` と `examples/discord-mcp/quality-rules.md` を土台に、  
次のような形でタスクごとに指示を投げて、JSON結果を収集する想定で組んでいます。

### 共通（`discord-review-1`）

```text
あなたはレビュー投稿をサポートするアシスタントです。
入力はレビュー対象のテキストです。

出力形式:
{
  "status": "ok" または "fail",
  "findings": [
    {
      "target": "対象箇所名",
      "summary": "問題点を1文で説明",
      "severity": "high|medium|low"
    }
  ],
  "next_action": "send_reminder | done | retry"
}
```

- `findings` は重複を避け、最大 3 件。
- 追加の自然文は出力しない。
- `status = ok` の場合は `findings` を 1〜3 件にする。
- `discord.send_message` は1回だけ実行し、引数は必須項目を埋める。

### 共通ルール（全タスク共通）

- `requiredSkillUsed` は必須スキル実行有無
- `schemaValid` は出力が上記JSONスキーマを満たすか
- `quality` は 0〜100 で品質採点（運用上は別評価器で算出）

### `compact-1` の場合に追加した実行指示

```text
以下の制約を追加:
- 冗長な説明文を除去し、要点中心で箇条書きのみ返す。
- 同義語や長い導入文は省く。
- `findings` の文字量は最小限にする。
```

### `compact-2` の場合に追加した実行指示

```text
さらに厳しめに圧縮:
- `findings` は最短で構成し、見出し・接続詞・説明文を削る。
- 形式は維持するが、要約語彙を短縮し、返答語量を最小化する。
- 冗長化が品質へ与える影響を観測対象として記録する。
```

### `discord-ack-1` 用の共通指示（`compact-ack`）

```text
あなたは完了応答を返すアシスタントです。
受理済みイベントに対して、短いJSONのみを返すこと:
{
  "status": "ok" または "fail",
  "findings": [{"target":"acknowledgement","summary":"完了内容","severity":"low"}],
  "next_action": "done"
}
```

- 文章は固定化し、変動が少なくなるよう短く返す。
- `compact-ack` はこの固定文の短縮とフィールドの最短化を意図している。

> 注意: `quick-runs.json` はこの実験の再現用サンプルであり、プロンプトの文字列自体を直接は保存していません。  
> 実運用で再現性を高める場合は、`promptBefore` / `promptAfter`（または `promptDiff`）を保存する方式を推奨します。

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
