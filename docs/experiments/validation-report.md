# context-optimizer 検証実験レポート

> 実施日: 2026-02-16
> 目的: このリポジトリの最適化手法が実際にワークするか検証する

## TL;DR

**コア最適化アルゴリズムは正しく動作する。** 手計算と全出力が一致し、予算制約下の貪欲選択は期待通りに機能する。ただし、**2つの実用上のバグ**と**1つの設計上の注意点**が見つかった。

| 項目 | 判定 |
|------|------|
| 期待利得の計算 (expectedGain) | ✅ 正確 |
| gainRatio によるランキング | ✅ 正確 |
| 予算制約下の貪欲選択 | ✅ 正確 |
| strictMode の品質フィルタ | ❌ バグ（実質機能していない） |
| data/ のサンプル CSV | ❌ バグ（ヘッダー形式が不正） |
| deriveVariants モード | ✅ 動作する |
| CLI の入出力 | ✅ 動作する（正しいデータ使用時） |

---

## 実験設計

5つの実験を設計し、合計 **11回** の CLI 実行と手計算照合を行った。

| 実験 | 目的 | タスク数 | バリアント数 |
|------|------|----------|-------------|
| 1 | 既存サンプルで基本動作確認 | 2 | 3 |
| 2 | 多タスク・多バリアント + 予算変動 | 5 | 11 |
| 3 | エッジケース（budget=0, 高violation, 全variant不適格） | 4 | 7 |
| 4 | deriveVariants モード | 5 | 11+9(derived) |
| 5 | 手計算との数値照合 | - | - |

---

## 実験1: 既存サンプル (examples/discord-mcp/samples/)

### 実行結果

```
基準コンテキスト: 1,098 tokens
推定コンテキスト: 888.525 tokens
推定削減量:       209.475 tokens (19.1% 削減)
使用工数:         13 / 16
```

| タスク | 選択バリアント | score | gain | effort |
|--------|---------------|-------|------|--------|
| discord-review-1 | compact-1 | 10.3635 | 165.82 | 8 |
| discord-ack-1 | compact-ack | 8.7318 | 43.66 | 5 |

### 手計算照合

```
compact-1:
  expectedGain = 90 × 0.94 × (1 - 0.02) = 82.908
  gainRatio    = 82.908 / 8 = 10.36350
  absoluteGain = 82.908 × 2(freq) = 165.816 → 出力: 165.82 ✓

compact-ack:
  expectedGain = 45 × 0.98 × (1 - 0.01) = 43.659
  gainRatio    = 43.659 / 5 = 8.7318
  absoluteGain = 43.659 × 1(freq) = 43.659 → 出力: 43.66 ✓

baseline = 2×419 + 1×260 = 1098 ✓
estimated = (838 - 165.816) + (260 - 43.659) = 888.525 ✓
```

**結果: 全数値が手計算と一致** ✅

> 注: runs が overwriteTasksWithRuns を通じて freq/baseline を上書きするため、
> baseline は原データの `120×420 + 40×260 = 60,800` ではなく、
> 実行ログの回数×平均トークン `2×419 + 1×260 = 1,098` になる。

---

## 実験2: 多タスク・多バリアント (5タスク×11バリアント)

### 予算による選択変化

| budget | 削減量 | 削減率 | 選択数 | 使用工数 |
|--------|--------|--------|--------|----------|
| 5 | 551.6 | 9.2% | 2/5 | 5 |
| 20 | 1,110.2 | 18.4% | 4/5 | 18 |
| 50 | 1,225.5 | 20.3% | 5/5 | 22 |

**観察**: 予算を4倍（5→20）にすると削減量は2倍になるが、10倍（5→50）にしても2.2倍にしかならない。**収穫逓減の法則**がはっきり見える。これは貪欲選択が高効率のバリアントから順に選ぶことの自然な帰結。

### budget=5 での選択（厳しい予算）

```
採用: slack-minimal   (effort=2, gain=236.41) ← 最高効率
採用: summary-minimal (effort=3, gain=315.22) ← 2番目の効率
未採用: 残り3タスク  ← 予算不足
```

**手計算照合** (budget=20):

```
spendable を absoluteGain 降順にソート:
  1. api-summary (summary-minimal):  gain=315.22, effort=3  → 累計effort=3  ≤ 20 → 採用
  2. code-review (review-bullet):    gain=279.30, effort=5  → 累計effort=8  ≤ 20 → 採用
  3. report-gen  (report-light):     gain=279.30, effort=8  → 累計effort=16 ≤ 20 → 採用
  4. slack-notify (slack-minimal):   gain=236.41, effort=2  → 累計effort=18 ≤ 20 → 採用
  5. translate   (trans-short):      gain=115.24, effort=4  → 累計effort=22 > 20 → 不採用

推定コンテキスト:
  = (1375 - 315.216) + (1950 - 279.3) + 485 + (265 - 236.412) + (1950 - 279.3)
  = 1059.784 + 1670.7 + 485 + 28.588 + 1670.7
  = 4914.772 → 出力: 4914.772 ✓
```

**結果: 全数値が手計算と一致** ✅

---

## 実験3: エッジケース

### 3a: budget=0 （予算ゼロ）

```
推定削減量: 0    ← 何も選択されない
使用工数:   0
全タスク:   未採用
```

**結果**: 正しくゼロケースを処理 ✅

### 3b: budget=100, strict=false （無制限予算・非strict）

```
推定削減量: 467.37
使用工数:   18
全タスク:   採用（4/4）
```

全タスクが最適バリアントを取得。使用工数は全バリアント合計に等しい。✅

### 3c: 「全variant不適格」タスクの挙動

「no-good-variant」(qualityGate=0.95) に violationRate=0.20 と 0.30 の2バリアントを設定。

**期待**: strict=true なら両方不適格 → 未採用
**実際**: **ngv-risky が採用された** (gain=224.00)

→ これは **strictMode フィルタのバグ** に起因する（次セクション参照）。

---

## 発見1: strictMode フィルタのバグ 🔴

### 証拠

実験2で **strict=true と strict=false が完全同一の結果** を出力した:

```
strict=true:  推定削減量=1110.23, 使用工数=18, 選択=[同一]
strict=false: 推定削減量=1110.23, 使用工数=18, 選択=[同一]
```

### 原因

`optimizer.ts:33`:
```typescript
const strictValid = input.strictMode
  ? variants.filter((v) => v.violationRate <= task.qualityGate)
  : variants;
```

**問題**: `qualityGate=0.95` のとき、`violationRate <= 0.95` が条件。
violationRate が 95% 未満ならすべて通過する。実用上ほぼ全バリアントが通る。

### 正しいロジック

qualityGate は「最低品質水準」（0.95 = 95%品質が必要）を意味する。
フィルタは「violation が許容範囲内か」をチェックすべき:

```typescript
// 修正案
variants.filter((v) => v.violationRate <= (1 - task.qualityGate))
// qualityGate=0.95 → violationRate <= 0.05 のみ通過
```

この修正で:
- compact-2 (violation=0.08): 0.08 > 0.05 → **不適格** ← 正しい
- ngv-risky (violation=0.20): 0.20 > 0.05 → **不適格** ← 正しい
- summary-minimal (violation=0.005): 0.005 ≤ 0.05 → **適格** ← 正しい

---

## 発見2: data/ のサンプル CSV ヘッダーバグ 🔴

### 症状

```bash
$ npm run discord:mcp
Error: runs: 1 行目の taskId が空です
```

### 原因

`data/runs.csv`:
```csv
# taskId,runId,inputTokens,status,qualityScore    ← "#" でコメント扱いされる
discord-review-1,run-001,420,ok,92                ← これがヘッダーとして扱われる
discord-review-1,run-002,410,ok,90                ← これがデータ行に
```

CSVパーサー (`cli.ts:87`) が `#` で始まる行を除外するため、本来のヘッダーが消失する。
最初のデータ行がヘッダーになり、フィールド名マッピングが破綻する。

### 修正

CSVヘッダーから `# ` プレフィックスを除去すればよい。

---

## 発見3: run-overwrite 時のバリアント整合性 ⚠️

`overwriteTasksWithRuns` は tasks の baseline を実行ログの平均に上書きするが、
variants の `reducedTokens` はオリジナル定義のまま。

例: slack-notify
- 元の baseline: 180 tokens/call
- runs 上書き後: 88.3 tokens/call
- variant (slack-minimal) の reducedTokens: 80

baseline が 88.3 なのに 80 トークン削減すると、残り 8.3 トークン/call になる。
`Math.max(0, ...)` で負値は防がれるが、意味的に不整合。

これは「注意すべき設計特性」であり、致命的なバグではない。

---

## 実験4: deriveVariants モード

実行ログから 9 個の derived variants が生成された。明示的バリアントとマージされ、
キーが重複するものは明示的定義が優先された。

```
derivedVariants: 9
最終選択: 明示的定義のバリアントが全採用（deriveVariantsは既存と重複）
```

**結果**: マージロジックは正しく動作 ✅

deriveVariants が本領を発揮するのは、明示的な variants.csv を持たず、
run ログのみからバリアント候補を自動推定するケース。

---

## 総合判定

### ワークするもの

1. **数学モデルの実装** — expectedGain, gainRatio の計算は手計算と完全一致
2. **貪欲予算選択** — absoluteGain 降順での貪欲選択が正しく動作、予算制約を遵守
3. **収穫逓減の可視化** — 予算増加と削減量の関係が直感的に理解できる出力
4. **deriveVariants** — 実行ログからのバリアント自動推定が動作
5. **CLI の入出力** — text/json 形式、CSV/JSON 入力、複数フィールド名対応

### ワークしないもの

1. **strictMode フィルタ** — `violationRate <= qualityGate` は意味的に逆。事実上フィルタなし
2. **data/ のサンプルデータ** — `npm run discord:mcp` が即座にエラー

### 実用への影響

strictMode バグにより、**品質ゲートが機能しない状態**。高い violation rate のバリアントが
品質チェックを通過して採用される。本番利用前に修正が必要。

ただし、コアの最適化ロジック自体は数学的に正確であり、
strictMode フィルタの1行修正で完全に機能するフレームワークになる。

---

## 再現手順

```bash
# ビルド
npm install && npm run build

# 実験1: 既存サンプル（動作する）
node dist/cli.js \
  --tasks examples/discord-mcp/samples/quick-tasks.csv \
  --variants examples/discord-mcp/samples/quick-variants.csv \
  --runs examples/discord-mcp/samples/quick-runs.json \
  --deriveVariants --budget 16 --strict true --format text

# 実験2: 多タスク（予算変動）
node dist/cli.js \
  --tasks experiments/exp2-multi/tasks.csv \
  --variants experiments/exp2-multi/variants.csv \
  --runs experiments/exp2-multi/runs.json \
  --budget 20 --strict true --format text

# strictMode バグの再現: strict=true と false で同一結果
node dist/cli.js \
  --tasks experiments/exp2-multi/tasks.csv \
  --variants experiments/exp2-multi/variants.csv \
  --runs experiments/exp2-multi/runs.json \
  --budget 20 --strict true --format text

node dist/cli.js \
  --tasks experiments/exp2-multi/tasks.csv \
  --variants experiments/exp2-multi/variants.csv \
  --runs experiments/exp2-multi/runs.json \
  --budget 20 --strict false --format text
# ↑ 両方の出力が完全一致する

# エッジケース: budget=0
node dist/cli.js \
  --tasks experiments/exp3-edge/tasks.csv \
  --variants experiments/exp3-edge/variants.csv \
  --runs experiments/exp3-edge/runs.json \
  --budget 0 --strict true --format text
```
