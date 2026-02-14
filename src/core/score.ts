import { VariantSpec } from './types';

export function expectedGain(v: VariantSpec): number {
  const safeSuccess = Math.max(0, Math.min(1, v.successRate));
  const safeViolation = Math.max(0, Math.min(1, 1 - v.violationRate));
  return v.reducedTokens * safeSuccess * safeViolation;
}

export function gainRatio(v: VariantSpec): number {
  if (v.requiredEffort <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return expectedGain(v) / v.requiredEffort;
}
