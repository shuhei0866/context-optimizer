# 使い方

このドキュメントは、`context-optimizer` を実運用に乗せる最短手順を示す。

---

## 1. データを用意する

### 1-1. タスク定義 (`TaskSpec`)

以下を最初に決める。

- `taskId`: 一意ID
- `name`: タスク名
- `frequency`: 期間あたりの呼び出し回数
- `baselineTokens`: 最適化前の平均入力トークン
- `qualityGate`: 品質ゲート（0.0〜1.0）

`templates/task-spec.example.json` を起点にする。

### 1-2. 試行結果を収集する

最小限の `runs` を揃える。

- `status`（ok/fail）
- `requiredSkillUsed`（呼び出しの有無）
- `schemaValid`（スキーマ適合）
- `qualityScore`（0〜100）

必要なら `qualityScore` は平均を使う前提で保存。

---

## 2. バリアントを登録する

`VariantSpec` の意味を明確にしておく。

- `reducedTokens`: 1回あたりの期待削減量
- `successRate`: 成功率（0.0〜1.0）
- `violationRate`: 品質違反率（0.0〜1.0）
- `requiredEffort`: 労力（相対値）

初期は1〜3個程度の小規模な候補から始めると失敗しにくい。

---

## 3. 最適化を実行する

```ts
import { selectVariants } from './src/core';

const report = selectVariants({
  tasks: [...],
  variants: [...],
  budget: 16,
  strictMode: true,
});

console.log(report);
```

重要出力:

- `baselineContext`: 最適化前の総コスト見積り
- `estimatedTotalContext`: 運用後見積り
- `estimatedSavings`: 期待削減量
- `selected`: タスクごとの採択結果

---

## 4. 結果の検証と導入

### 4-1. まず最小導入

1. まず1タスクだけ導入
2. 3〜5回の再試行で回帰率を確認
3. 失敗があればロールバック

### 4-2. 段階的ロールアウト

1. 重要度順に採択順でロールアウト
2. 監視ルールを満たすまで拡大

---

## 4.1 Discord MCP 実験CLI

`data/*` のサンプルを使って、Discord MCP向けの改善候補選定をすぐ実行できる。

```bash
npm run discord:mcp
```

このコマンドは以下を実行する。

- `data/tasks.csv` を読み込む
- `data/experiments.csv` を改善候補として読む
- `data/runs.csv` を読み込んで、品質サマリを表示
- 予算制約下で最適化し、採択結果を表示
- `--deriveVariants` を付けると、runs の `variant_id` 付きログから成功率・違反率・削減量を再推定

別形式で試す場合は CLI を直接実行。

```bash
npm run build
node dist/cli.js --tasks data/tasks.csv --variants data/experiments.csv --runs data/runs.csv --budget 16 --format json
node dist/cli.js --tasks data/tasks.csv --variants data/experiments.csv --runs examples/discord-mcp/sample-runs.json --deriveVariants --format json
```

主なオプション:

- `--tasks`: タスク定義（CSV/JSON）
- `--variants`: 改善候補定義（CSV/JSON）
- `--runs`: 実行ログ（CSV/JSON）
- `--budget`: 工数予算
- `--strict`: `true` / `false`（品質違反条件）
- `--qualityGate`: 全体の品質ゲートを上書き
- `--deriveVariants`: 変種ログから `reducedTokens/successRate/violationRate` を再推定
- `--defaultEffort`: derive時の工数既定値（既定: 1）
- `--qualityPassThreshold`: そのままの品質スコアで合格とみなす閾値（0-100）

---

## 5. 監視ループ

最低限追跡する指標:

- コンテキスト削減率
- タスク成功率
- 違反率（schema違反、必須アクション未実行）
- 連続失敗回数

以下の条件なら再実験またはロールバック。

- 違反率が想定より悪化
- 成功率が閾値を下回る
- 削減率が前回より著しく低下

---

## 6. 継続的最適化

1. 1〜2週間ごとに `frequency`, `baselineTokens` を更新
2. `selectVariants` 再計算
3. 新規バリアントが効いているか ablation で比較
4. 使わなくなった要素を削ってさらなる短縮へ

---

## 7. ドキュメント品質の基準

公開前提のため、README・テンプレート・型定義は常に同期させること。  
実装変更があれば同じ変更で `docs` の 1 か所以上を同時更新する。
