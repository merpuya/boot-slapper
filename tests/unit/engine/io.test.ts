import { describe, expect, it } from "vitest";
import { FakeIo, RealIo } from "../../../src/engine/io.ts";

describe("FakeIo", () => {
  it("reads and writes files in memory and records writes", async () => {
    const io = new FakeIo({ files: { "/h/a.txt": "one\n" } });
    expect(await io.readFile("/h/a.txt")).toBe("one\n");
    expect(await io.readFile("/h/missing")).toBeNull();
    await io.writeFile("/h/b.txt", "two\n", { mode: 0o600 });
    expect(await io.readFile("/h/b.txt")).toBe("two\n");
    expect(io.modes.get("/h/b.txt")).toBe(0o600);
    expect(io.writes).toEqual(["/h/b.txt"]);
  });

  it("tracks directories via mkdirp and readdir", async () => {
    const io = new FakeIo({ dirs: ["/h/d"], files: { "/h/d/x": "", "/h/d/y": "" } });
    expect(await io.isDir("/h/d")).toBe(true);
    expect((await io.readdir("/h/d")).sort()).toEqual(["x", "y"]);
    expect(await io.readdir("/h/nope")).toEqual([]);
    await io.mkdirp("/h/new/deep");
    expect(await io.isDir("/h/new/deep")).toBe(true);
    expect(await io.isDir("/h/new")).toBe(true);
  });

  it("routes exec through registered handlers and records every call", async () => {
    const io = new FakeIo();
    io.on((c) => c === "git", () => ({ code: 0, stdout: "abc123\n", stderr: "" }));
    const r = await io.exec("git", ["rev-parse", "HEAD"], { cwd: "/h" });
    expect(r.stdout).toBe("abc123\n");
    expect(io.calls).toEqual([{ cmd: "git", args: ["rev-parse", "HEAD"], opts: { cwd: "/h" } }]);
  });

  it("returns code 127 for an unhandled command", async () => {
    const io = new FakeIo();
    const r = await io.exec("nope", []);
    expect(r.code).toBe(127);
  });

  it("resolves which() from the path map", async () => {
    const io = new FakeIo({ path: { git: "/usr/bin/git" } });
    expect(await io.which("git")).toBe("/usr/bin/git");
    expect(await io.which("jq")).toBeNull();
  });
});

describe("RealIo.exec", () => {
  it("kills a hung child on timeout and resolves code 124 instead of hanging", async () => {
    const io = new RealIo();
    const start = Date.now();
    const r = await io.exec("node", ["-e", "setTimeout(() => {}, 10000)"], { timeout: 200 });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(r.code).toBe(124);
    expect(r.stderr).toContain("[timeout]");
  });
  it("does not crash the process when the child exits before stdin is fully written", async () => {
    const io = new RealIo();
    // the child exits immediately without reading stdin; writing a stdin payload after that
    // can raise EPIPE on the stdin stream — exec() must swallow it, not crash the test runner.
    const r = await io.exec("node", ["-e", "process.exit(0)"], { stdin: "x".repeat(1_000_000) });
    expect(r.code).toBe(0);
  });
});

describe("Io.fetch", () => {
  it("FakeIo records calls, answers via onFetch, and never rejects", async () => {
    const io = new FakeIo();
    io.onFetch((u) => u.endsWith("/v1/models"), () => ({ status: 200, body: '{"data":[]}' }));
    expect(await io.fetch("https://gw/v1/models", { headers: { Authorization: "Bearer x" } })).toEqual({ status: 200, body: '{"data":[]}' });
    expect(await io.fetch("https://gw/other")).toEqual({ status: 0, body: "fetch not handled" });
    expect(io.fetches.map((f) => f.url)).toEqual(["https://gw/v1/models", "https://gw/other"]);
  });
  it("RealIo resolves {status: 0} on a connection failure instead of throwing", async () => {
    const io = new RealIo();
    const r = await io.fetch("http://127.0.0.1:1/nope", { timeout: 2000 });
    expect(r.status).toBe(0);
    expect(r.body.length).toBeGreaterThan(0);
  });
});
