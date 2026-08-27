export const PARENT_EXPANSION = "off" as const;
export const CONFLICT_DETECTION = "off" as const;

export function expandParent(content: string): string {
  return content;
}

export function detectConflicts(): never[] {
  return [];
}
