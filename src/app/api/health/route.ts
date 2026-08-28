import { getCloudflareContext } from "@opennextjs/cloudflare";

type BrainBinding = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export async function GET(): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const brain = (env as { BRAIN?: BrainBinding }).BRAIN;
  if (!brain) {
    return Response.json(
      { code: "UNAVAILABLE", message: "Brain is not bound to this web worker." },
      { status: 503 },
    );
  }
  return brain.fetch("https://brain.internal/health");
}
