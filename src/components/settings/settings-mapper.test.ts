import { describe, expect, it } from "vitest";

import type { WorkspaceIdentity } from "@/app/actions";
import { mapAccount, mapAdminSettings, type BrainConfig } from "@/components/settings/settings-mapper";

const member: WorkspaceIdentity = {
  id: "u1",
  kind: "user",
  subject: "maya.chen@northwind.example",
  name: "Maya R. Chen",
  email: "maya.chen@northwind.example",
  roles: ["standard"],
  departments: ["engineering"],
  isAdmin: false,
  department: "engineering",
  readableDocumentCount: 34,
};

const config: BrainConfig = {
  models: {
    answer: "@cf/zai-org/glm-5.3-flash",
    embedding: "@cf/qwen/qwen3-embedding-0.6b",
    reranker: "@cf/baai/bge-reranker-base",
  },
  retrieval: { mode: "hybrid", passages: 8, rerankFloor: 0.05, configVersion: "cfg" },
  activeGenerationId: "g-c305cf57-9f37-4620-a847-1cefae894469",
  connectors: [
    { id: "source-upload", label: "upload", kind: "upload", approval: false, status: "active" },
    { id: "tool-create_ticket", label: "create_ticket", kind: "action", approval: true, status: "connected" },
  ],
};

describe("mapAccount", () => {
  it("never carries a total for a member", () => {
    const account = mapAccount(member, 62);
    expect(account).toMatchObject({
      name: "Maya R. Chen",
      email: "maya.chen@northwind.example",
      role: "Member",
      department: "Engineering",
      readableDocuments: 34,
    });
    expect(account.totalDocuments).toBeUndefined();
  });

  it("falls back to the subject when the account has no name", () => {
    const loopback = { ...member, name: null, email: null, subject: "dev@localhost" };
    expect(mapAccount(loopback)).toMatchObject({ name: "dev@localhost", email: "dev@localhost" });
  });

  it("carries the total for an admin", () => {
    const admin = { ...member, isAdmin: true };
    expect(mapAccount(admin, 62)).toMatchObject({ role: "Admin", totalDocuments: 62 });
  });
});

describe("mapAdminSettings", () => {
  it("maps live config and connectors", () => {
    const { config: mapped, connectors } = mapAdminSettings(config, 65);
    expect(mapped).toEqual({
      answerModel: "@cf/zai-org/glm-5.3-flash",
      embeddingModel: "@cf/qwen/qwen3-embedding-0.6b",
      rerankerModel: "@cf/baai/bge-reranker-base",
      retrieval: "Hybrid, keyword and vector",
      passagesPerAnswer: 8,
      rerankFloor: 0.05,
      activeGeneration: "g-c305cf57",
    });
    expect(connectors.map((c) => [c.name, c.status, c.description])).toEqual([
      ["Uploads", "active", "Built in · 65 documents"],
      ["Support desk", "connected", "Creates tickets, each one needs your approval"],
      ["GitHub", "not_connected", "Sync a repository folder into a draft"],
    ]);
    expect(connectors[2].connectable).toBe(true);
  });

  it("says document, not documents, for a single upload", () => {
    const { connectors } = mapAdminSettings(config, 1);
    expect(connectors[0].description).toBe("Built in · 1 document");
  });

  it("shows keyword retrieval and no generation honestly", () => {
    const { config: mapped } = mapAdminSettings(
      { ...config, retrieval: { ...config.retrieval, mode: "keyword" }, activeGenerationId: null },
      0,
    );
    expect(mapped.retrieval).toBe("Keyword");
    expect(mapped.activeGeneration).toBe("None");
  });
});
