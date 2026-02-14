---
title: Obsidian 数式ノート（KaTeX / MathJax / AI向け参照版）
source: https://qiita.com/K-Fluid/items/c318b21448dfcbc2f960
tags:
  - obsidian
  - latex
  - mathjax
  - formula
  - ai-reference
  - japanese
---

# Obsidian 数式ノート（KaTeX / MathJax / AI向け）

本ノートは Qiita 記事の内容を **Obsidian で壊れにくく読むことを最優先** して再構成した参照用ドキュメントです。

Obsidian/Markdown で数式を書く場合は基本的に以下を使う。

- インライン: `$...$`
- ブロック表示: `$$...$$`

`$...$` と `$$...$$` は環境差分で崩れにくく、Obsidian で扱いやすい。

---

## 1. 参照前提

- Obsidian は MathJax 系の数式描画を利用。
- 同一ノート内で「記事の例」を再利用できるよう、`コードブロック`と`レンダリング版`の両方を併記。
- 長い式や整形が必要な式は、ブロック数式 + 環境を使う。

---

## 2. 基本

### 2.1 インライン

```
$ f(x) = x^2 $
```

表示: $f(x)=x^2$

### 2.2 ディスプレイ（1行）

```
$$
\int_a^b x^2 \, dx = \frac{b^3-a^3}{3}
$$
```

$$
\int_a^b x^2 \, dx = \frac{b^3-a^3}{3}
$$

---

## 3. 複雑な数式の書き方

### 3.1 改行が必要な式

```
$$
\begin{split}
 f(x) = a_9 x^9 &+ a_8 x^8 + a_7 x^7 + a_6 x^6 + a_5 x^5 \\
&+ a_4 x^4 + a_3 x^3 + a_2 x^2 + a_1 x + a_0
\end{split}
$$
```

$$
\begin{split}
 f(x) = a_9 x^9 &+ a_8 x^8 + a_7 x^7 + a_6 x^6 + a_5 x^5 \\
&+ a_4 x^4 + a_3 x^3 + a_2 x^2 + a_1 x + a_0
\end{split}
$$

### 3.2 変形の揃え表示

```
$$
\begin{align}
 f(x) &= (x+1)^2 \\
 &= x^2 + 2x + 1
\end{align}
$$
```

$$
\begin{align}
 f(x) &= (x+1)^2 \\
 &= x^2 + 2x + 1
\end{align}
$$

### 3.3 連立方程式

```
$$
\left\{
\begin{align}
2x+y &=3 \\
3x-4y&=1
\end{align}
\right.
$$
```

$$
\left\{
\begin{align}
2x+y &=3 \\
3x-4y&=1
\end{align}
\right.
$$

### 3.4 場合分け

```
$$
\begin{cases}
  f(x)=x^2, & x \ge 0 \\
  f(x)=0, & x < 0
\end{cases}
$$
```

$$
\begin{cases}
  f(x)=x^2, & x \ge 0 \\
  f(x)=0, & x < 0
\end{cases}
$$

---

## 4. 出力調整（見栄え）

- `\,` : 細い空白
- `\quad` / `\qquad` : 大きめの空白
- 分数は `\frac{a}{b}` を基本にする

---

## 5. トラブル時のチェックリスト（AI向け）

- `\left` と `\right` の対応数を確認
- `&` は整列位置だけに使う
- 長文式は必ず `$$...$$` にする
- バックスラッシュを 1 つ余計に消さない（`\\` が必要）
- `align` 系は行末 `\\` が必要
- Obsidian のプラグインやテーマ差分で未対応コマンドがあるか確認

---

## 6. AI 参照用テンプレート

### 6.1 1行目で使う計測式

```
$$
\hat{C} = \sum_{i=1}^{n} a_i b_i
$$
```

### 6.2 条件分岐つき確率式

```
$$
P(X=x)=
\begin{cases}
1/n, & x\in\{1,\ldots,n\} \\
0, & \text{otherwise}
\end{cases}
$$
```

### 6.3 最適化系（AIが説明しやすい形）

```
$$
\max_{x\in\mathcal{X}} \, f(x) \quad \text{s.t.} \quad g(x)\le 0,\; h(x)=0
$$
```

---

## 7. 補足

このノートは記事要約を、Obsidian で表示崩れしにくいように再構成した AI 参照用です。
必要なら次は「本文テンプレート版（最小構文版）」「厳密再現版（記事コマンド寄り）」の2種類に分けて、運用用に分割保存できます。
