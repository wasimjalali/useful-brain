export const AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER = "cf-aig-collect-log-payload";

export function aiGatewayRequestHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set(AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER, "false");
  return headers;
}

export function assertAiGatewayPayloadCollectionDisabled(headers: Headers): void {
  const value = headers.get(AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER);
  if (value !== "false") {
    throw new Error("AI Gateway payload collection must be disabled on production model requests");
  }
}
