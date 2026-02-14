export interface EvaluationInput {
  status: 'ok' | 'fail';
  requiredSkillUsed: boolean;
  argsValid: boolean;
  schemaValid: boolean;
  qualityScore: number;
}

export function evaluateOutput(input: EvaluationInput): number {
  const gate = input.requiredSkillUsed && input.argsValid ? 1 : 0;
  if (input.status === 'fail' || !gate || !input.schemaValid) {
    return 0;
  }
  const normalizedQuality = Math.max(0, Math.min(100, input.qualityScore));
  return 0.3 * 1 + 0.6 * (normalizedQuality / 100) + 0.1;
}
