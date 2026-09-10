import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";

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
