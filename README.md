# context-optimizer

A small framework for minimizing LLM context usage by optimization-first prompt and task management.

The project is designed to solve:

- Which tasks should be optimized first
- How much context budget can be saved
- How to keep quality guarantees while reducing prompt size

## Features

- Task-level scoring with frequency and average token usage
- Variant-level improvement estimation (`gain`, `quality`, `cost`)
- Greedy baseline optimizer for first rollout
- Reusable templates for task specification and evaluation
- Discord MCP review scenario examples
- Minimal evaluator abstraction for quality rules

## Project structure

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
├─ tests/
├─ data/
│  ├─ tasks.csv
│  ├─ runs.csv
│  └─ experiments.csv
├─ .github/workflows/ci.yml
└─ .gitignore
```

## Quick start

1. Define task metrics in a `TaskSpec`.
2. Estimate baseline frequency and context usage.
3. Add optimization variants and their estimated reduction/quality/effect.
4. Run the optimizer and select highest-score variants within budget.

## Scope

- Context optimization is done at task level, not individual model outputs.
- Quality is evaluated by explicit rules, not stylistic preference.
- This repository targets practical repeatability with minimal context overhead.

## License

MIT. See `LICENSE`.
