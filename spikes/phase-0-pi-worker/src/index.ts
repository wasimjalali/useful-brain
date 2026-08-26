import {
  reconstructAgent,
  runSpikePrompt,
  runSpikeUntilAbort,
  type DurableSnapshot,
} from "./pi-run";

const encoder = new TextEncoder();

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        spike: "phase-0-pi-worker",
        provider: "faux",
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      snapshot?: DurableSnapshot;
    };
    const prompt = body.prompt ?? "Increment the counter and record the result.";

    switch (url.pathname) {
      case "/run":
        return streamJsonLines(await runSpikePrompt(prompt));
      case "/cancel":
        return Response.json(await runSpikeUntilAbort(prompt));
      case "/reconstruct": {
        const first = await runSpikePrompt(prompt);
        const durable: DurableSnapshot = body.snapshot ?? {
          systemPrompt:
            "You are a Phase 0 spike agent. Call increment_counter then record_value.",
          messages: first.messages,
        };
        const firstAgent = reconstructAgent(durable).agent;
        const second = reconstructAgent(durable);
        const continued = await runSpikePrompt("Confirm reconstructed state.", {
          messages: durable.messages,
        });
        return Response.json({
          firstMessageCount: first.messages.length,
          reconstructedMessageCount: second.agent.state.messages.length,
          sameInstance: second.agent === firstAgent,
          continuedOk: continued.events.some((event) => event.type === "agent_end"),
        });
      }
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;

function streamJsonLines(payload: unknown): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
