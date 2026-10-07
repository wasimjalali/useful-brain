import { describe, expect, it } from "vitest";

import { aclGroupKey } from "../acl/acl-group";
import { WorkerValidationError } from "../cf/worker-errors";
import {
  MAX_UPLOAD_BYTES,
  parseUploadRequest,
  readersToAcl,
  uploadDocumentId,
} from "./upload-validation";

const base = {
  readers: { kind: "everyone" },
  idempotencyKey: "batch-key-1",
  files: [{ name: "leave-policy.pdf", size: 1024 }],
};

describe("upload request validation", () => {
  it("rejects unsupported formats, oversize files and unsafe names", () => {
    const bad = (files: unknown) => () => parseUploadRequest({ ...base, files });
    expect(bad([{ name: "malware.exe", size: 10 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "page.html", size: 10 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "noextension", size: 10 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "zero.md", size: 0 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "frac.md", size: 1.5 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "../../etc/passwd.md", size: 10 }])).toThrow(WorkerValidationError);
    expect(bad([{ name: "a\u0000b.md", size: 10 }])).toThrow(WorkerValidationError);
    expect(bad([])).toThrow(WorkerValidationError);
    expect(bad("nope")).toThrow(WorkerValidationError);
    expect(bad([{ name: "a.md", size: 5 }, { name: "A.MD", size: 5 }])).toThrow(WorkerValidationError);
  });

  it("accepts pdf, docx, md, markdown and txt at exactly 25 MB", () => {
    const parsed = parseUploadRequest({
      ...base,
      files: [
        { name: "a.pdf", size: MAX_UPLOAD_BYTES },
        { name: "b.DOCX", size: 1 },
        { name: "c.md", size: 1 },
        { name: "d.markdown", size: 1 },
        { name: "e.txt", size: 1 },
      ],
    });
    expect(parsed.files).toHaveLength(5);
  });

  it("rejects a bad idempotency key and unknown reader shapes", () => {
    expect(() => parseUploadRequest({ ...base, idempotencyKey: "has space" })).toThrow(
      WorkerValidationError,
    );
    expect(() => parseUploadRequest({ ...base, idempotencyKey: undefined })).toThrow(
      WorkerValidationError,
    );
    expect(() => parseUploadRequest({ ...base, readers: { kind: "private" } })).toThrow(
      WorkerValidationError,
    );
    expect(() => parseUploadRequest({ ...base, readers: { kind: "departments", names: [] } })).toThrow(
      WorkerValidationError,
    );
  });
});

describe("readers to ACL", () => {
  it("maps everyone, departments and roles to access scopes", () => {
    expect(readersToAcl({ kind: "everyone" })).toEqual({
      accessScope: "public",
      allowedRoles: [],
      allowedDepartments: [],
    });
    expect(readersToAcl({ kind: "departments", names: ["hr", "finance", "hr"] })).toEqual({
      accessScope: "department",
      allowedRoles: [],
      allowedDepartments: ["finance", "hr"],
    });
    expect(readersToAcl({ kind: "roles", names: ["hr_manager"] })).toEqual({
      accessScope: "role",
      allowedRoles: ["hr_manager"],
      allowedDepartments: [],
    });
  });

  it("rejects names outside the department and role vocabulary, and the admin role", () => {
    expect(() => readersToAcl({ kind: "departments", names: ["engineering", "pirates"] })).toThrow(
      WorkerValidationError,
    );
    expect(() => readersToAcl({ kind: "roles", names: ["admin"] })).toThrow(WorkerValidationError);
    expect(() => readersToAcl({ kind: "roles", names: ["Manager"] })).toThrow(WorkerValidationError);
    expect(() => readersToAcl({ kind: "departments", names: ["HR"] })).toThrow(WorkerValidationError);
  });

  it("produces the same ACL group key retrieval would compute for the shape", async () => {
    const acl = readersToAcl({ kind: "departments", names: ["support", "sales"] });
    const key = await aclGroupKey({ ...acl, ownerUserId: "" });
    const again = await aclGroupKey({
      accessScope: "department",
      allowedRoles: [],
      allowedDepartments: ["sales", "support"],
      ownerUserId: "",
    });
    expect(key).toBe(again);
    const other = await aclGroupKey({ ...readersToAcl({ kind: "everyone" }), ownerUserId: "" });
    expect(other).not.toBe(key);
  });
});

describe("upload document id", () => {
  it("is stable per normalized file name and differs between names", async () => {
    expect(await uploadDocumentId("Leave Policy.PDF")).toBe(await uploadDocumentId("leave policy.pdf"));
    expect(await uploadDocumentId("a.md")).not.toBe(await uploadDocumentId("b.md"));
    expect(await uploadDocumentId("a.md")).toMatch(/^upl-[0-9a-f]{24}$/);
  });
});
