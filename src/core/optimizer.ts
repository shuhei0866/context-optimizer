import { OptimizationInput, OptimizedVariant, OptimizationReport, VariantSpec } from './types.js';
import { gainRatio, expectedGain } from './score.js';

function makeNoVariant(taskId: string, taskName: string): OptimizedVariant {
  return {
    taskId,
    taskName,
    score: 0,
    expectedGain: 0,
    expectedLoss: 0,
  };
}

export function selectVariants(input: OptimizationInput): OptimizationReport {
  const variantsByTask: Record<string, VariantSpec[]> = {};

  for (const variant of input.variants) {
    if (!(variant.taskId in variantsByTask)) {
      variantsByTask[variant.taskId] = [];
    }
    variantsByTask[variant.taskId].push(variant);
  }

  const baselineContext = input.tasks.reduce((sum, task) => {
    return sum + task.frequency * task.baselineTokens;
  }, 0);

  const candidates: OptimizedVariant[] = [];

  for (const task of input.tasks) {
    const variants = variantsByTask[task.taskId] ?? [];
    const strictValid = input.strictMode
      ? variants.filter((v) => v.violationRate <= (1 - task.qualityGate))
      : variants;

    const valid = strictValid.filter((v) => v.reducedTokens > 0 && v.requiredEffort > 0);

    if (valid.length === 0) {
      candidates.push(makeNoVariant(task.taskId, task.name));
      continue;
    }

    const ranked = valid.slice().sort((a, b) => gainRatio(b) - gainRatio(a));
    const best = ranked[0];

    candidates.push({
      taskId: task.taskId,
      taskName: task.name,
      variantId: best.variantId,
      score: gainRatio(best),
      expectedGain: expectedGain(best) * task.frequency,
      expectedLoss: best.requiredEffort,
    });
  }

  const selected: OptimizedVariant[] = [];
  let usedEffort = 0;

  const spendable = candidates
    .filter((item) => item.expectedLoss > 0)
    .sort((a, b) => b.expectedGain - a.expectedGain);

  for (const item of spendable) {
    if (usedEffort + item.expectedLoss > input.budget) {
      continue;
    }
    selected.push(item);
    usedEffort += item.expectedLoss;
  }

  const selectedMap = new Map(selected.map((item) => [item.taskId, item]));
  const finalSelected = input.tasks.map((task) =>
    selectedMap.get(task.taskId) ?? makeNoVariant(task.taskId, task.name),
  );

  const estimatedContext = finalSelected.reduce((sum, item, index) => {
    const task = input.tasks[index];
    const gain = item.expectedGain;
    return sum + Math.max(0, task.frequency * task.baselineTokens - gain);
  }, 0);

  return {
    baselineContext,
    selected: finalSelected,
    usedEffort,
    estimatedTotalContext: estimatedContext,
    estimatedSavings: baselineContext - estimatedContext,
  };
}
