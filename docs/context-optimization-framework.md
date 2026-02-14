# Context Optimization Framework

This repository uses a quantitative, reproducible process for reducing LLM context usage while keeping quality controls.

## Core idea

Optimize by task, not by one-off prompts:

- `frequency` (how often a task runs)
- `baselineTokens` (average tokens consumed before optimization)
- expected improvements from a variant

## Score model

Expected gain is estimated as:

`expectedGain = reducedTokens * successRate * (1 - violationRate)`

A score per effort is:

`score = expectedGain / requiredEffort`

## Constraint rule

- Keep only candidates that pass minimum quality gates.
- Choose candidates under a fixed effort budget.

## Output contract

Output should be machine-validated. Free-form answers are discouraged in core paths.
