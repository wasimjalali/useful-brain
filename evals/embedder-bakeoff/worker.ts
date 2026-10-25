// Eval-only Worker: forwards one embedding call to the remote Workers AI
// binding and reports how long the model call took. Run it locally with
// `wrangler dev -c evals/embedder-bakeoff/wrangler.jsonc`; it is never deployed.

const MODELS = new Set(["@cf/qwen/qwen3-embedding-0.6b", "@cf/baai/bge-m3"]);

type Env = {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/embed") {
      return new Response("not found", { status: 404 });
    }
    const body = (await request.json()) as { model?: unknown; input?: unknown };
    if (typeof body.model !== "string" || !MODELS.has(body.model)) {
      return new Response("model not allowed", { status: 400 });
    }
    if (!body.input || typeof body.input !== "object") {
      return new Response("input required", { status: 400 });
    }
    const started = Date.now();
    const output = await env.AI.run(body.model, body.input as Record<string, unknown>);
    return Response.json({ ms: Date.now() - started, output });
  },
};

export default worker;
