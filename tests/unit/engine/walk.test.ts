import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { walkFiles } from "../../../src/engine/walk.ts";

describe("walkFiles", () => {
  it("lists files under a root as sorted posix-relative paths, skipping .git", async () => {
    const io = new FakeIo({ files: { "/r/b.md": "", "/r/a/x.txt": "", "/r/a/y/z.txt": "", "/r/.git/HEAD": "ref", "/elsewhere/q": "" } });
    expect(await walkFiles(io, "darwin", "/r")).toEqual(["a/x.txt", "a/y/z.txt", "b.md"]);
    expect(await walkFiles(io, "darwin", "/missing")).toEqual([]);
  });
});
