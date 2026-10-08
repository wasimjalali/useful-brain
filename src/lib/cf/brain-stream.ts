import {
  createBrainServiceRequest,
  type BrainService,
} from "@/lib/cf/service-binding-identity";

/**
 * PUT a request body to Brain without reading it. The browser's body stream is
 * handed to the service binding as it arrives; Brain checks the declared length
 * and writes it straight into R2. The session cookie travels, nothing else does.
 */
export function createBrainStreamRequest(input: {
  incomingHeaders: Headers;
  path: string;
  body: ReadableStream<Uint8Array>;
  contentLength: number;
}): Request {
  const base = createBrainServiceRequest({
    incomingHeaders: input.incomingHeaders,
    path: input.path,
    method: "PUT",
  });
  const headers = new Headers(base.headers);
  headers.set("content-length", String(input.contentLength));
  headers.set("content-type", "application/octet-stream");
  return new Request(base.url, {
    method: "PUT",
    headers,
    body: input.body,
    // Required by fetch when the body is a stream.
    duplex: "half",
  } as RequestInit);
}

export function brainStreamPut(
  brain: BrainService,
  input: Parameters<typeof createBrainStreamRequest>[0],
): Promise<Response> {
  return brain.fetch(createBrainStreamRequest(input));
}
