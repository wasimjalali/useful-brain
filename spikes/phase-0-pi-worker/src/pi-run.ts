import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { Type, type Static } from "typebox";

const IncrementParams = Type.Object({
  amount: Type.Optional(Type.Number()),
});

const RecordParams = Type.Object({
  note: Type.String(),
});

export type SpikeEvent = {
  type: AgentEvent["type"];
  toolName?: string;
  assistantEventType?: string;
  textDelta?: string;
};

export type ToolTrace = {
  tool: string;
  phase: "start" | "end";
  at: number;
};

export type DurableSnapshot = {
  systemPrompt: string;
  messages: AgentMessage[];
};

export type SpikeRunResult = {
  events: SpikeEvent[];
  toolTrace: ToolTrace[];
  messages: AgentMessage[];
  counter: number;
  notes: string[];
  aborted: boolean;
  errorMessage?: string;
};

type SpikeOptions = {
  messages?: AgentMessage[];
  tokensPerSecond?: number;
  longText?: boolean;
};

function createTools(state: {
  counter: number;
  notes: string[];
  toolTrace: ToolTrace[];
}): AgentTool[] {
  const incrementTool: AgentTool<typeof IncrementParams, { counter: number }> = {
    name: "increment_counter",
    label: "Increment counter",
    description: "Mutating sequential counter for the Phase 0 spike.",
    parameters: IncrementParams,
    executionMode: "sequential",
    execute: async (_toolCallId, params: Static<typeof IncrementParams>, signal) => {
      state.toolTrace.push({ tool: "increment_counter", phase: "start", at: Date.now() });
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 8));
      signal?.throwIfAborted();
      state.counter += params.amount ?? 1;
      state.toolTrace.push({ tool: "increment_counter", phase: "end", at: Date.now() });
      return {
        content: [{ type: "text", text: `counter=${state.counter}` }],
        details: { counter: state.counter },
      };
    },
  };

  const recordTool: AgentTool<typeof RecordParams, { note: string }> = {
    name: "record_value",
    label: "Record value",
    description: "Second mutating sequential tool for the Phase 0 spike.",
    parameters: RecordParams,
    executionMode: "sequential",
    execute: async (_toolCallId, params: Static<typeof RecordParams>, signal) => {
      state.toolTrace.push({ tool: "record_value", phase: "start", at: Date.now() });
      signal?.throwIfAborted();
      state.notes.push(params.note);
      state.toolTrace.push({ tool: "record_value", phase: "end", at: Date.now() });
      return {
        content: [{ type: "text", text: `recorded=${params.note}` }],
        details: { note: params.note },
      };
    },
  };

  return [incrementTool, recordTool];
}

export function createSpikeAgent(options: SpikeOptions = {}) {
  const runState = {
    counter: 0,
    notes: [] as string[],
    toolTrace: [] as ToolTrace[],
  };
  const faux = fauxProvider({
    provider: "useful-brain-phase0-faux",
    tokensPerSecond: options.tokensPerSecond,
  });
  const model = faux.getModel();
  const systemPrompt =
    "You are a Phase 0 spike agent. Call increment_counter then record_value.";

  if (options.longText) {
    faux.setResponses([
      fauxAssistantMessage(
        "This is a long unpaid streaming reply used only to prove AbortController cancellation in the Phase 0 Worker spike. ".repeat(
          40,
        ),
        { stopReason: "stop" },
      ),
    ]);
  } else {
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("Incrementing then recording."),
          fauxToolCall("increment_counter", { amount: 1 }),
          fauxToolCall("record_value", { note: "after-increment" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Done.")], { stopReason: "stop" }),
    ]);
  }

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: createTools(runState),
      messages: options.messages ?? [],
    },
    streamFn: (nextModel, context, streamOptions) =>
      faux.provider.streamSimple(nextModel, context, streamOptions),
    toolExecution: "sequential",
  });

  return { agent, faux, runState, systemPrompt };
}

export function collectEvents(agent: Agent): SpikeEvent[] {
  const events: SpikeEvent[] = [];
  agent.subscribe((event) => {
    events.push(toSpikeEvent(event));
  });
  return events;
}

function toSpikeEvent(event: AgentEvent): SpikeEvent {
  if (event.type === "message_update") {
    return {
      type: event.type,
      assistantEventType: event.assistantMessageEvent.type,
      textDelta:
        event.assistantMessageEvent.type === "text_delta"
          ? event.assistantMessageEvent.delta
          : undefined,
    };
  }
  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_end"
  ) {
    return { type: event.type, toolName: event.toolName };
  }
  return { type: event.type };
}

export async function runSpikePrompt(
  prompt: string,
  options: SpikeOptions = {},
): Promise<SpikeRunResult> {
  const { agent, runState } = createSpikeAgent(options);
  const events = collectEvents(agent);
  await agent.prompt(prompt);
  await agent.waitForIdle();
  return toResult(agent, events, runState);
}

export async function runSpikeUntilAbort(
  prompt: string,
): Promise<SpikeRunResult> {
  const { agent, runState } = createSpikeAgent({
    longText: true,
    tokensPerSecond: 12,
  });
  const events = collectEvents(agent);
  const started = new Promise<void>((resolve) => {
    agent.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        resolve();
      }
    });
  });
  const pending = agent.prompt(prompt);
  await started;
  agent.abort();
  await pending;
  await agent.waitForIdle();
  return toResult(agent, events, runState);
}

export function snapshotState(agent: Agent): DurableSnapshot {
  return {
    systemPrompt: agent.state.systemPrompt,
    messages: structuredClone(agent.state.messages),
  };
}

export function reconstructAgent(snapshot: DurableSnapshot) {
  return createSpikeAgent({ messages: snapshot.messages });
}

function toResult(
  agent: Agent,
  events: SpikeEvent[],
  runState: { counter: number; notes: string[]; toolTrace: ToolTrace[] },
): SpikeRunResult {
  return {
    events,
    toolTrace: runState.toolTrace,
    messages: structuredClone(agent.state.messages),
    counter: runState.counter,
    notes: [...runState.notes],
    aborted: Boolean(agent.state.errorMessage),
    errorMessage: agent.state.errorMessage,
  };
}
