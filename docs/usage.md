# Usage

1. Define task baseline:
   - `taskId`
   - `frequency`
   - `baselineTokens`

2. Add optimization variants:
   - reduced tokens
   - success rate
   - violation rate
   - required effort

3. Run optimizer:
   - pick top variants under budget
   - verify with 3+ runs minimum

4. Promote and monitor:
   - watch rollback conditions
   - periodically re-calculate baseline
