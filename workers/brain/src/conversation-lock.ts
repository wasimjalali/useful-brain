import { acquireRunLock, releaseRunLock } from "../../../src/lib/cf/run-lock";

type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export class ConversationRunLock {
  constructor(private readonly ctx: { storage: Storage }) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const runId = (await request.text()).trim();
    const current = await this.ctx.storage.get<string>("runId");

    if (url.pathname === "/lock" && request.method === "POST") {
      const result = acquireRunLock(current, runId);
      if (!result.ok) {
        return new Response("locked", { status: result.status });
      }
      await this.ctx.storage.put("runId", result.runId);
      return new Response("ok");
    }

    if (url.pathname === "/unlock" && request.method === "POST") {
      const result = releaseRunLock(current, runId);
      if (!result.ok) {
        return new Response("locked", { status: result.status });
      }
      await this.ctx.storage.delete("runId");
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}
