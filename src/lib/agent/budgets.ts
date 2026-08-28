export const AGENT_BUDGETS = {
  maxTurns: 8,
  maxToolCalls: 8,
  maxSearchKnowledge: 4,
  maxInputTokens: 32_000,
  maxOutputTokens: 4_000,
  wallTimeMs: 90_000,
  modelTimeoutMs: 60_000,
  readToolTimeoutMs: 10_000,
  approvalExpiryMs: 15 * 60 * 1000,
  maxRedactedToolResultBytes: 32 * 1024,
  maxRawExternalBytes: 1024 * 1024,
} as const;

export class BudgetExceededError extends Error {
  constructor(
    readonly code: "TURN_LIMIT" | "TOOL_LIMIT" | "SEARCH_LIMIT" | "WALL_TIME" | "TOKEN_LIMIT",
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class BudgetTracker {
  turns = 0;
  toolCalls = 0;
  searchKnowledgeCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  readonly startedAt = Date.now();

  remainingWallTimeMs(now = Date.now()): number {
    return Math.max(0, AGENT_BUDGETS.wallTimeMs - (now - this.startedAt));
  }

  assertWithinWallTime(now = Date.now()): void {
    if (now - this.startedAt > AGENT_BUDGETS.wallTimeMs) {
      throw new BudgetExceededError("WALL_TIME", "interactive wall time budget exhausted");
    }
  }

  noteTurn(): void {
    this.turns += 1;
    if (this.turns > AGENT_BUDGETS.maxTurns) {
      throw new BudgetExceededError("TURN_LIMIT", "turn budget exhausted");
    }
  }

  noteToolCall(name: string): void {
    this.toolCalls += 1;
    if (this.toolCalls > AGENT_BUDGETS.maxToolCalls) {
      throw new BudgetExceededError("TOOL_LIMIT", "tool-call budget exhausted");
    }
    if (name === "search_knowledge") {
      this.searchKnowledgeCalls += 1;
      if (this.searchKnowledgeCalls > AGENT_BUDGETS.maxSearchKnowledge) {
        throw new BudgetExceededError("SEARCH_LIMIT", "search_knowledge budget exhausted");
      }
    }
  }

  noteTokens(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
    if (this.inputTokens > AGENT_BUDGETS.maxInputTokens || this.outputTokens > AGENT_BUDGETS.maxOutputTokens) {
      throw new BudgetExceededError("TOKEN_LIMIT", "token budget exhausted");
    }
  }
}
