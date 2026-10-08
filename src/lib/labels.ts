const ROLE_LABELS: Record<string, string> = {
  manager: "Managers",
  director: "Directors",
  executive: "Executives",
  hr_manager: "HR managers",
  finance_manager: "Finance managers",
  support_manager: "Support managers",
  sales_manager: "Sales managers",
  standard: "Members",
};

function capitalize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Wire department ids ("hr", "sales") as people read them ("HR", "Sales"). */
export function departmentLabel(name: string): string {
  return name === "hr" ? "HR" : capitalize(name);
}

/** Wire role ids ("hr_manager") as people read them ("HR managers"). */
export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? capitalize(name);
}

/** "g-c305cf57-1b2a-..." as "g-c305cf57". Other ids are returned unchanged. */
export function shortGenerationId(id: string): string {
  return /^g-[0-9a-f]{8}/.exec(id)?.[0] ?? id;
}

const MODEL_NAMES: Record<string, string> = {
  "@cf/zai-org/glm-5.3-flash": "GLM 5.3 Flash",
  "@cf/zai-org/glm-5.3": "GLM 5.3",
  "@cf/qwen/qwen3-embedding-0.6b": "Qwen3 Embedding 0.6B",
  "@cf/baai/bge-reranker-base": "BGE Reranker Base",
};

/** A Workers AI model id as people read it. Unknown ids are returned unchanged. */
export function modelDisplayName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}
