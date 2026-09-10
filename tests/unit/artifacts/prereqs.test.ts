import { describe, expect, it } from "vitest";
import { prereqs } from "../../../src/artifacts/prereqs.ts";
import { makeCtx } from "../helpers.ts";

const allTools = { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", claude: "/h/.local/bin/claude" };

describe("prereqs", () => {
  it("is present and all-ok when every tool exists", async () => {
    const { ctx, io } = await makeCtx({ path: allTools, dirs: ["/Applications/Claude.app"] });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect(await prereqs.detect(ctx)).toEqual({ kind: "present" });
    expect(prereqs.plan(ctx, { kind: "present" })).toEqual([]);
    const checks = await prereqs.verify(ctx);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(["git", "curl", "jq", "python", "node", "claude", "desktop", "platform"]);
  });
  it("blocks on a missing hard prerequisite and names it", async () => {
    const { ctx, io } = await makeCtx({ path: { ...allTools, jq: undefined as unknown as string } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect(await prereqs.detect(ctx)).toEqual({ kind: "blocked", reason: "missing jq" });
    expect((await prereqs.verify(ctx)).find((c) => c.id === "jq")).toMatchObject({ status: "error" });
  });
  it("treats node < 22.5 as an error and a missing claude/desktop as warnings", async () => {
    const { ctx, io } = await makeCtx({ path: { ...allTools, claude: undefined as unknown as string } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v20.11.1\n", stderr: "" }));
    const checks = await prereqs.verify(ctx);
    expect(checks.find((c) => c.id === "node")).toMatchObject({ status: "error", message: expect.stringMatching(/v20\.11\.1 < 22\.5/) });
    expect(checks.find((c) => c.id === "claude")).toMatchObject({ status: "warn", message: expect.stringMatching(/claude\.ai\/install\.sh/) });
    expect(checks.find((c) => c.id === "desktop")).toMatchObject({ status: "warn" });
  });
  it("accepts `python` when `python3` is absent (Git Bash on Windows)", async () => {
    const { ctx, io } = await makeCtx({ platform: "win32", home: "C:\\Users\\t", path: { ...allTools, python3: undefined as unknown as string, python: "C:\\py\\python.exe" } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect((await prereqs.verify(ctx)).find((c) => c.id === "python")).toMatchObject({ status: "ok" });
  });
  it("treats a node that exits non-zero as missing even if it prints a version", async () => {
    const { ctx, io } = await makeCtx({ path: allTools });
    io.on((c) => c === "node", () => ({ code: 1, stdout: "v22.12.0\n", stderr: "broken shim" }));
    expect((await prereqs.verify(ctx)).find((c) => c.id === "node")).toMatchObject({ status: "error", message: "prereq missing: node ≥ 22.5" });
  });
});
