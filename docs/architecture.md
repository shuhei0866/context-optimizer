# Architecture

```text
Collector -> Evaluator -> Profiler -> Optimizer -> Rollout -> Monitor
```

- `Collector`: stores task run history
- `Evaluator`: computes pass/fail and quality scores
- `Profiler`: calculates frequency and baseline costs
- `Optimizer`: picks best variants under budget
- `Rollout`: deploys minimal templates
- `Monitor`: checks drift and rollback conditions
