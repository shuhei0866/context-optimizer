export type QualityThreshold = number;

export type TaskId = string;

export type VariantId = string;

export interface TaskSpec {
  taskId: TaskId;
  name: string;
  frequency: number;
  baselineTokens: number;
  qualityGate: QualityThreshold;
  effortBudget?: number;
}

export interface VariantSpec {
  variantId: VariantId;
  taskId: TaskId;
  name: string;
  reducedTokens: number;
  successRate: number;
  violationRate: number;
  requiredEffort: number;
  schemaConformRate?: number;
}

export interface OptimizationInput {
  tasks: TaskSpec[];
  variants: VariantSpec[];
  budget: number;
  strictMode?: boolean;
  violationWeight?: number;
}

export interface OptimizedVariant {
  taskId: TaskId;
  taskName: string;
  variantId?: VariantId;
  score: number;
  expectedGain: number;
  expectedLoss: number;
}

export interface OptimizationReport {
  baselineContext: number;
  selected: OptimizedVariant[];
  usedEffort: number;
  estimatedTotalContext: number;
  estimatedSavings: number;
}
