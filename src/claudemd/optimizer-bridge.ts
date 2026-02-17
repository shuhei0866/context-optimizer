import type { TaskSpec, VariantSpec } from '../core/types.js';
import { selectVariants } from '../core/optimizer.js';
import type { MarkdownSection } from './section-parser.js';
import { estimateTokens } from './token-estimator.js';

export interface OptimizationSuggestion {
  heading: string;
  tokens: number;
  priority: 'HIGH' | 'MED' | 'LOW';
  reason: string;
  measured?: boolean; // true if violationRate comes from evaluate results
}

export interface EvalOverride {
  sectionHeading: string;
  violationRate: number;
  reducedTokens: number;
}

/**
 * Map CLAUDE.md sections to TaskSpec/VariantSpec and run the optimizer
 * to determine which sections should be prioritized for compression.
 *
 * evalOverrides が指定された場合、ハードコードの violationRate/reducedTokens を
 * evaluate 結果の実測値で上書きする。
 */
export function suggestOptimizations(
  sections: MarkdownSection[],
  evalOverrides?: EvalOverride[],
): OptimizationSuggestion[] {
  if (sections.length === 0) return [];

  // Map sections to TaskSpec (each section is a "task" that consumes tokens every turn)
  const tasks: TaskSpec[] = sections.map((section, i) => ({
    taskId: `section-${i}`,
    name: section.heading,
    frequency: 1, // Every turn includes the full CLAUDE.md
    baselineTokens: estimateTokens(section.content),
    qualityGate: 0.9, // High quality gate — compression shouldn't lose important info
  }));

  // Generate compression variants
  // Use evalOverrides if available, otherwise assume ~40% compression with hardcoded rates
  const overrideMap = new Map(
    (evalOverrides ?? []).map((o) => [o.sectionHeading, o]),
  );

  const variants: VariantSpec[] = sections
    .map((section, i) => {
      const baseline = estimateTokens(section.content);
      const override = overrideMap.get(section.heading);

      const reducedTokens = override?.reducedTokens ?? Math.round(baseline * 0.4);
      if (reducedTokens < 20) return null;

      return {
        variantId: `compress-${i}`,
        taskId: `section-${i}`,
        name: `${section.heading} 圧縮版${override ? '（実測）' : ''}`,
        reducedTokens,
        successRate: override ? 1 - override.violationRate : 0.95,
        violationRate: override?.violationRate ?? 0.05,
        requiredEffort: 1,
      };
    })
    .filter((v): v is VariantSpec => v !== null);

  if (variants.length === 0) return [];

  // Run optimizer to rank sections by compression benefit
  const report = selectVariants({
    tasks,
    variants,
    budget: variants.length, // Allow all compressions
    strictMode: true,
  });

  // Convert to suggestions
  const suggestions: OptimizationSuggestion[] = [];

  for (const selected of report.selected) {
    if (!selected.variantId) continue; // No variant = no optimization needed

    const task = tasks.find((t) => t.taskId === selected.taskId);
    if (!task) continue;

    const tokens = task.baselineTokens;
    let priority: 'HIGH' | 'MED' | 'LOW';
    let reason: string;

    if (tokens >= 300) {
      priority = 'HIGH';
      reason = '圧縮による削減余地大';
    } else if (tokens >= 150) {
      priority = 'MED';
      reason = '箇条書き化で圧縮可';
    } else {
      priority = 'LOW';
      reason = '軽微な改善余地';
    }

    const measured = overrideMap.has(task.name);
    suggestions.push({ heading: task.name, tokens, priority, reason, measured });
  }

  // Sort by tokens descending
  suggestions.sort((a, b) => b.tokens - a.tokens);

  return suggestions;
}
