import { describe, expect, it } from "vitest";

import {
  AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER,
  aiGatewayRequestHeaders,
  assertAiGatewayPayloadCollectionDisabled,
} from "./ai-gateway";

describe("AI Gateway payload collection", () => {
  it("sets cf-aig-collect-log-payload to false on every production model request", () => {
    const headers = aiGatewayRequestHeaders({ authorization: "Bearer test" });
    expect(headers.get(AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER)).toBe("false");
    expect(() => assertAiGatewayPayloadCollectionDisabled(headers)).not.toThrow();
  });

  it("fails the configuration test when payload collection is left on", () => {
    expect(() =>
      assertAiGatewayPayloadCollectionDisabled(new Headers({ [AI_GATEWAY_COLLECT_LOG_PAYLOAD_HEADER]: "true" })),
    ).toThrow(/payload collection must be disabled/);
  });
});
