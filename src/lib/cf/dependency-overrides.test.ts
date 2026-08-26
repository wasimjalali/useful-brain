/** @vitest-environment node */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const workspace = process.cwd();
const extractDirs: string[] = [];

afterEach(() => {
  for (const directory of extractDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("patched production-tree overrides", () => {
  it("pins postcss, nanoid and adm-zip to patched versions", () => {
    const pkg = JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8")) as {
      overrides: Record<string, string>;
    };
    expect(pkg.overrides).toEqual({
      postcss: "8.5.26",
      nanoid: "3.3.18",
      "adm-zip": "0.6.0",
    });
    expect(JSON.parse(readFileSync(path.join(workspace, "node_modules/postcss/package.json"), "utf8")).version).toBe(
      "8.5.26",
    );
    expect(JSON.parse(readFileSync(path.join(workspace, "node_modules/nanoid/package.json"), "utf8")).version).toBe(
      "3.3.18",
    );
    expect(JSON.parse(readFileSync(path.join(workspace, "node_modules/adm-zip/package.json"), "utf8")).version).toBe(
      "0.6.0",
    );
  });

  it("keeps rclone.js extractEntryTo working on adm-zip 0.6", async () => {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("rclone-v1.0.0-linux-amd64/rclone", Buffer.from("#!/bin/sh\necho rclone\n"));
    const archive = zip.toBuffer();

    const extracted = new AdmZip(archive);
    const target = mkdtempSync(path.join(tmpdir(), "useful-brain-adm-zip-"));
    extractDirs.push(target);
    extracted.getEntries().forEach((entry) => {
      if (/rclone(\.exe)?$/.test(entry.name)) {
        extracted.extractEntryTo(entry, target, false, true);
      }
    });
    expect(readFileSync(path.join(target, "rclone"), "utf8")).toContain("echo rclone");
  });
});
