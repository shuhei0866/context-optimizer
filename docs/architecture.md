# アーキテクチャ

本フレームワークは「計測→評価→最適化→反映→監視」の循環で構成される。

```text
Collector -> Evaluator -> Profiler -> Optimizer -> Rollout -> Monitor -> (戻り: Collector)
```

- Collector  
  - `runs`, `tasks`, `experiments` を収集
  - 連続実行データ、失敗履歴、実測トークンを蓄積
- Evaluator  
  - `status`, `requiredSkillUsed`, `schemaValid` などで品質を数値化
  - 成功率・違反率を計算
- Profiler  
  - 各タスクの `frequency`, `baselineTokens` を更新
  - 期間ごとの推移を作成
- Optimizer  
  - `src/core/optimizer.ts` が `OptimizationInput` を受け取り最適候補を返却
- $score = \frac{gain}{effort}$ で粗い優先順位づけ
- Rollout  
  - `templates/*` を更新
  - プロンプト差分だけをデプロイし、不要な説明を削る
- Monitor  
  - 逸脱監視（品質低下、違反率上昇、節約量低下）
  - 必要ならロールバック

---

## レイヤーの責務

### データ層

- `data/tasks.csv`
- `data/runs.csv`
- `data/experiments.csv`
- 追加導入時は、データ整形を先に定義してから最適化に渡す

### モデル層

- `src/core/types.ts`
- `TaskSpec`, `VariantSpec`, `OptimizationInput` を明文化
- 仕様が曖昧なままロジックが増えると、再現性が崩れるため、この層を厳密に保つ

### 計算層

- `src/core/score.ts`
  - `expectedGain` と `gainRatio` の計算
- `src/core/optimizer.ts`
  - 候補選定、工数制約下での採択
- `src/core/evaluator.ts`
  - 出力品質スコアの下地
- `src/core/ablation.ts`
  - 要素除去時のインパクト観測

### テンプレート層

- `templates/task-spec.schema.json`
- `templates/task-spec.example.json`
- `templates/evaluation-config.yaml`
- `templates/prompt-base.md`

---

## 受け渡しインターフェース（実装向け）

- 入力: `OptimizationInput`
- 出力: `OptimizationReport`
- 各タスクの最適化有無、期待削減量、推定残コスト、使用工数を返却

この固定インターフェースにより、別言語実装や外部ツールへの接続がしやすい。
