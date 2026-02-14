export type PromptElement =
  | 'role'
  | 'constraints'
  | 'examples'
  | 'schema'
  | 'tone'
  | 'instructions';

export interface AblationResult {
  element: PromptElement;
  beforeScore: number;
  afterScore: number;
}

export function impact(ablated: AblationResult): number {
  return ablated.afterScore - ablated.beforeScore;
}

export function shouldKeep(ablated: AblationResult, threshold: number): boolean {
  return impact(ablated) >= threshold;
}
