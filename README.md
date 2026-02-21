# context-optimizer

Claude Code セッションのコンテキスト消費を分析・最適化する CLI ツール。

セッション JSONL ログからトークン消費パターンを可視化し、CLAUDE.md の圧縮と AGENTS.md によるコードベース探索コストの削減を支援する。

---

## 背景: コンテキストはどこに消えるか

471 セッションの分析から判明した消費内訳:

| カテゴリ | 比率 | 最適化手段 |
|---|---|---|
| 会話履歴の膨張 | ~50-60% | セッション分割 |
| コードベース探索（Read/Grep） | ~25-30% | **AGENTS.md** で削減 |
| CLAUDE.md | ~10-27% | **圧縮** で削減 |

Read 操作の 17.9% がセッション内重複という知見も得られている。

---

## インストール

```bash
git clone https://github.com/shuhei0866/context-optimizer.git
cd context-optimizer
npm install
npm run build
```

---

## コマンド一覧

### セッション分析

#### `analyze` — セッション単位のトークン消費

```bash
# 最新セッションを分析
context-optimizer analyze

# プロジェクト内の全セッション
context-optimizer analyze --project my-app --all --per-turn

# CSV エクスポート
context-optimizer analyze --project my-app --all --export sessions.csv
```

#### `insights` — プロジェクト横断の傾向分析

```bash
# 全プロジェクトの集計
context-optimizer insights

# 特定プロジェクト、上限100セッション
context-optimizer insights --project my-app --limit 100
```

プロジェクト別の平均コスト、キャッシュヒット率、高コストツールパターンを表示。

#### `diagnose` — コンテキスト消費の診断

```bash
context-optimizer diagnose --project my-app --limit 30
```

セッション JSONL からファイルアクセスを抽出し、以下を診断:

- **探索ホットスポット**: どのディレクトリが頻繁に探索されているか
- **Read 重複率**: 同じファイルを何度も読んでいないか
- **CLAUDE.md 比率**: コンテキストに占める CLAUDE.md の割合
- **AGENTS.md カバレッジ**: ホットスポットに AGENTS.md があるか
- **推奨事項**: 上記に基づく改善提案

### CLAUDE.md 最適化

#### `claudemd` — トークンコスト分析

```bash
context-optimizer claudemd
```

CLAUDE.md をセクション分割し、各セクションのトークン数と圧縮可能性を評価。

#### `evaluate` — 圧縮品質の評価

```bash
# 圧縮品質を LLM-as-judge で評価
context-optimizer evaluate --trials 4

# ドライラン（テストケース確認のみ）
context-optimizer evaluate --dry-run

# 結果を保存
context-optimizer evaluate --save
```

原文と圧縮版で LLM の行動が変わらないかを定量評価。

#### `apply` — 圧縮結果の適用

```bash
# diff を確認
context-optimizer apply --dry-run

# 適用
context-optimizer apply --yes
```

evaluate の結果をもとに CLAUDE.md を書き換え。違反率が閾値以下のセクションのみ適用。

### AGENTS.md 管理

#### `agents scan` — カバレッジスキャン

```bash
context-optimizer agents scan /path/to/project
```

プロジェクト内のディレクトリを再帰スキャンし、AGENTS.md の有無とコードファイル数を一覧表示。diagnose のホットスポットと組み合わせて、どこに AGENTS.md を置くべきかを判断する。

#### `agents generate` — スケルトン生成

```bash
# stdout に出力
context-optimizer agents generate /path/to/project/src/lib/quiz

# ファイルに保存
context-optimizer agents generate /path/to/project/src/lib/quiz --output AGENTS.md
```

ディレクトリ内のファイル構造からスケルトン AGENTS.md を自動生成。

---

## データフロー

```
~/.claude/projects/**/*.jsonl    プロジェクトディレクトリ
        |                                |
        +---> analyze ---> サマリー       +---> agents scan ---> カバレッジ一覧
        |                                |
        +---> insights --> 横断集計       +---> agents generate -> スケルトン
        |
        +---> diagnose --> ホットスポット / 重複率 / 推奨事項
        |
        +---> claudemd --> セクション別コスト
                |
                +---> evaluate --> 圧縮品質スコア
                        |
                        +---> apply --> CLAUDE.md 書き換え
```

---

## 最適化の 2 軸

1. **CLAUDE.md 圧縮**（`claudemd` → `evaluate` → `apply`）
   - コンテキストの 10-27% を占める CLAUDE.md を、行動品質を保ちつつトークン数を削減

2. **探索コスト削減**（`diagnose` → `agents scan` → `agents generate`）
   - コンテキストの 25-30% を占めるコードベース探索を、AGENTS.md でナビゲーションして削減

---

## 全オプションリファレンス

```
context-optimizer <command> [options]

analyze:
  --session <id>          特定セッションを分析
  --project <name|path>   プロジェクト内のセッションを分析
  --all                   全プロジェクト横断
  --last                  最新セッションのみ（デフォルト）
  --per-turn              ターン別内訳を表示
  --format text|json      出力形式（デフォルト: text）
  --export <path>         CSV エクスポート

insights:
  --project <name|path>   特定プロジェクトのみ
  --all                   全プロジェクト横断（デフォルト）
  --limit <n>             分析セッション数上限（デフォルト: 50）
  --format text|json      出力形式（デフォルト: text）

diagnose:
  --project <name|path>   対象プロジェクト（必須）
  --limit <n>             分析セッション数（デフォルト: 30）
  --format text|json      出力形式（デフォルト: text）

claudemd:
  --format text|json      出力形式（デフォルト: text）

evaluate:
  --section <name>        特定セクションのみ評価
  --trials <n>            試行数（デフォルト: 4）
  --judge-model <model>   判定モデル
  --subject-model <model> 被験者モデル
  --format text|json      出力形式（デフォルト: text）
  --save                  結果をレポートファイルに保存
  --dry-run               API 呼び出しなし

apply:
  --file <path>           対象 CLAUDE.md（デフォルト: グローバル）
  --report <path>         レポートファイル（デフォルト: latest.json）
  --max-violation <rate>  許容する最大違反率（デフォルト: 0.1）
  --yes                   確認なしで適用
  --dry-run               diff 表示のみ

agents scan <project-path>:
  --min-files <n>         最小ファイル数（デフォルト: 3）
  --depth <n>             スキャン深度（デフォルト: 4）
  --format text|json      出力形式（デフォルト: text）

agents generate <directory>:
  --output <path>         出力先（デフォルト: stdout）
```

---

## 理論的背景

反復実行タスクのコンテキスト削減を離散最適化として定式化している。詳細は [docs/context-optimization-framework.md](docs/context-optimization-framework.md) を参照。

`src/core/` の `selectVariants` は、タスク候補を価値密度でソートし予算内で採択する貪欲近似を実装。

---

## ライセンス

MIT。`LICENSE` を参照。
