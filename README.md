# context-optimizer

LLM タスクの「コンテキスト最適化」を、再現可能な形で進めるための最小フレームワーク。

同一/類似タスクを繰り返し実行する場面で、  
`呼び出し回数 × 1回あたりコンテキスト` が大きいものを優先的に最適化する。

- AI 向け運用規約: [AGENTS.md](AGENTS.md)
- 数式記法（Obsidian 向け）: [docs/obsidian-kfluid-math-for-ai.md](docs/obsidian-kfluid-math-for-ai.md)

---

## 目的

- コンテキストコストの高いタスクを選定する
- 品質制約を守りつつ、必要最小コンテキストに近づける
- 事前定義した評価ルールで再現性を担保する
- 実験ログから改善前後を比較し、継続的に更新する

---

## 何を解くか（数理）

`TaskSpec` と `VariantSpec` を用いて、以下を最小化します。

- 最適化の総工数（`budget`）の制約
- 品質ゲートを満たす `score` の高い候補選択

基礎式は簡潔で、`docs/context-optimization-framework.md` に詳しく記載。

## 理論的な背景

この問題は、反復実行タスクの「コンテキスト削減」を目標にする離散最適化です。  
同じタスクを窓口（観測期間）内で何度も実行するほど、1 回あたりの改善余地は累積的に効いてきます。

タスク集合を $T$、各タスクを $i$ とします。各タスクに対し候補改善案の集合を $V_i$ とし、  
「改善案 $v$ を採択するか」の変数を $x_{i,v}\in\{0,1\}$ で表します。

1 タスクあたり 1 つだけ採択（または未採択）とするため、次が成り立ちます。

$$
\sum_{v\in V_i}x_{i,v}\le 1\quad(\forall i\in T),\quad x_{i,v}\in\{0,1\}
$$

各タスクの主要パラメータは次です。

$$
\begin{aligned}
f_i &: \text{観測窓あたりの呼び出し回数} \\
u_i &: \text{改善前 1 回あたりの期待コンテキスト消費量} \\
r_i(v) &: \text{改善案 }v\text{の 1 回あたり期待削減量（理想値）} \\
q_i(v) &: \text{改善案 }v\text{の品質違反率（1 回あたり）} \\
e_i(v) &: \text{改善案 }v\text{の実装工数}
\end{aligned}
$$

品質を守るため、安全削減値を次のように定義します。

$$
\Delta C_i^{\text{safe}}(v)
= f_i\cdot \max(0,\min(u_i,r_i(v)))\cdot(1-q_i(v))
$$

総予算 $B$ 下で、総安全削減量を最大化する 0-1 最適化は以下になります。

$$
\max \sum_{i\in T}\sum_{v\in V_i}\Delta C_i^{\text{safe}}(v)\,x_{i,v}
$$

$$
\sum_{i\in T}\sum_{v\in V_i}e_i(v)x_{i,v}\le B,\quad
\sum_{v\in V_i}x_{i,v}\le 1
$$

`selectVariants` はこの整数計画を、実務向けに近い近似解として実装している関数です。  
現行実装は「候補を価値密度で並べ、予算内で採択する」貪欲近似を採用し、最小限の計算量で再現性を担保します。

---

## ディレクトリ構成

```text
context-optimizer/
├─ README.md
├─ LICENSE
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md
├─ docs/
│  ├─ context-optimization-framework.md
│  ├─ architecture.md
│  └─ usage.md
├─ examples/
│  ├─ discord-mcp/
│  │  ├─ prompt-template.md
│  │  ├─ quality-rules.md
│  │  └─ sample-runs.json
│  └─ general/
│     └─ minimal-example.md
├─ templates/
│  ├─ task-spec.schema.json
│  ├─ task-spec.example.json
│  ├─ evaluation-config.yaml
│  └─ prompt-base.md
├─ src/
│  └─ core/
│     ├─ types.ts
│     ├─ optimizer.ts
│     ├─ score.ts
│     ├─ evaluator.ts
│     ├─ ablation.ts
│     └─ index.ts
├─ data/
│  ├─ tasks.csv
│  ├─ runs.csv
│  └─ experiments.csv
├─ tests/
├─ .github/workflows/ci.yml
└─ .gitignore
```

---

## クイックスタート

### 1. 依存関係

```bash
npm install
npm run typecheck
```

### 2. 最適化を回す（TypeScript）

```ts
import { TaskSpec, selectVariants } from './src/core';

const tasks: TaskSpec[] = [
  {
    taskId: 'discord-review-1',
    name: 'Discord レビュー投稿',
    frequency: 120,
    baselineTokens: 420,
    qualityGate: 0.95,
  },
];

const variants = [
  {
    variantId: 'compact-1',
    taskId: 'discord-review-1',
    name: 'プロンプト圧縮',
    reducedTokens: 90,
    successRate: 0.94,
    violationRate: 0.02,
    requiredEffort: 8,
  },
];

const result = selectVariants({
  tasks,
  variants,
  budget: 20,
  strictMode: true,
});

console.log(result);
```

`selectVariants` は以下を返します。

- タスクごとの最適候補
- 想定削減量
- 工数使用率
- 最終コンテキスト見積り

### 3. 結果の運用

- `selected` 候補をテンプレートに反映
- 最低 3 回以上の追試で品質安定性を確認
- 2 週間ごとに baseline と成功率を再計測

### 4. Discord MCP 実験

```bash
npm run discord:mcp
```

このコマンドは `data/tasks.csv` / `data/experiments.csv` / `data/runs.csv` を使って、  
Discord MCP 向けの選定を最短で回します。

必要なら `--deriveVariants` を付けて、`runs` ログから `successRate` / `violationRate` / `reducedTokens` を再推定できます。

```bash
npm run build
node dist/cli.js --tasks data/tasks.csv --variants data/experiments.csv --runs examples/discord-mcp/sample-runs.json --deriveVariants --format json
```

---

## 重要な前提

- 本リポジトリは「実験設計 + 選定ロジック」を主軸にしています
- 生成品質の評価は必ず `evaluation` 仕様で数値化する
- 出力形式は固定（JSON / スキーマ）を前提に最適化する

---

## ライセンス

MIT。`LICENSE` を参照。
