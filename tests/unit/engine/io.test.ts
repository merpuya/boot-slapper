import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("RealIo.killLive", () => {
  it.skipIf(process.platform === "win32")("kills a child an exec is still waiting on, and refuses to start another afterwards", async () => {
    const io = new RealIo();
    const pending = io.exec("sleep", ["30"]);
    const t0 = Date.now();
    io.killLive();
    const r = await pending;
    expect(r.code).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await io.exec("echo", ["hi"])).toMatchObject({ code: 130, stderr: "[interrupted]" });
  });

  it("realpath follows links (any depth, any case on a win32 fake), returns null for a missing path, and null for a link cycle", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\h", dirs: ["C:\\real\\store"], links: { "C:\\h\\a": "C:\\h\\b", "C:\\h\\b": "C:\\real\\store", "C:\\h\\x": "C:\\h\\y", "C:\\h\\y": "C:\\h\\x" } });
    expect(await io.realpath("C:\\h\\a")).toBe("C:\\real\\store");
    expect(await io.realpath("C:\\H\\A")).toBe("C:\\real\\store");
    expect(await io.realpath("C:\\real\\store")).toBe("C:\\real\\store");
    expect(await io.realpath("C:\\real\\nope")).toBeNull();
    expect(await io.realpath("C:\\h\\x")).toBeNull();
  });
});

describe("RealIo.realpath", () => {
  it("resolves a symlink to its target and returns null for a path that does not exist", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bs-realpath-"));
    try {
      mkdirSync(path.join(root, "real"));
      symlinkSync(path.join(root, "real"), path.join(root, "link"));
      const io = new RealIo();
      expect(await io.realpath(path.join(root, "link"))).toBe(await io.realpath(path.join(root, "real")));
      expect(await io.realpath(path.join(root, "link", "missing"))).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("Io.lstat / Io.readlink", () => {
  it("FakeIo: a dangling link is still a link (realpath cannot see it), found by its own spelling or through a linked parent", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\h", dirs: ["C:\\h\\docs", "C:\\h\\plain"], links: { "C:\\h\\docs\\later": "C:\\store\\not-yet", "D:\\subst": "C:\\h\\docs", "C:\\h\\docs\\rel": "..\\plain" } });
    expect(await io.realpath("C:\\h\\docs\\later")).toBeNull();
    expect(await io.lstat("C:\\h\\docs\\later")).toEqual({ isSymbolicLink: true });
    expect(await io.lstat("C:\\H\\DOCS\\LATER")).toEqual({ isSymbolicLink: true });
    expect(await io.lstat("D:\\subst\\later")).toEqual({ isSymbolicLink: true });
    expect(await io.readlink("D:\\subst\\later")).toBe("C:\\store\\not-yet");
    expect(await io.readlink("C:\\h\\docs\\rel")).toBe("..\\plain");
    expect(await io.lstat("C:\\h\\plain")).toEqual({ isSymbolicLink: false });
    expect(await io.readlink("C:\\h\\plain")).toBeNull();
    expect(await io.lstat("C:\\h\\nothing")).toBeNull();
    expect(await io.readlink("C:\\h\\nothing")).toBeNull();
  });
  it("RealIo: reports a dangling link as a link with its stored target, a plain folder as not a link, and null for a missing path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "bs-lstat-"));
    try {
      const target = path.join(root, "not-yet"), link = path.join(root, "later");
      // A junction needs no privilege on Windows (a symlink does); the type argument is ignored elsewhere.
      symlinkSync(target, link, process.platform === "win32" ? "junction" : undefined);
      const io = new RealIo();
      expect(await io.realpath(link)).toBeNull();
      expect(await io.lstat(link)).toEqual({ isSymbolicLink: true });
      // Windows may hand a junction's target back with a \\?\ prefix or a trailing separator; compare the folder it names.
      const named = (x: string) => { const r = path.resolve(root, x.replace(/^\\\\\?\\/, "")); return process.platform === "win32" ? r.toLowerCase() : r; };
      expect(named((await io.readlink(link))!)).toBe(named(target));
      expect(await io.lstat(root)).toEqual({ isSymbolicLink: false });
      expect(await io.readlink(root)).toBeNull();
      expect(await io.lstat(path.join(root, "missing"))).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
