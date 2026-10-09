import { describe, expect, it } from "vitest";
import { resolveHomePath } from "../../../src/engine/paths.ts";

describe("resolveHomePath (home-relative sourceDir)", () => {
  it("expands ~ and ~/x against the home of the target os", () => {
    expect(resolveHomePath("darwin", "/Users/t", "~")).toBe("/Users/t");
    expect(resolveHomePath("darwin", "/Users/t", "~/Documents/Claude/.claude/skills")).toBe("/Users/t/Documents/Claude/.claude/skills");
    expect(resolveHomePath("win32", "C:\\Users\\t", "~\\Claude\\.claude\\skills")).toBe("C:\\Users\\t\\Claude\\.claude\\skills");
    expect(resolveHomePath("win32", "C:\\Users\\t", "~/Claude/.claude/skills")).toBe("C:\\Users\\t\\Claude\\.claude\\skills");
  });
  it("treats a bare relative path as home-relative", () => {
    expect(resolveHomePath("darwin", "/Users/t", "Documents/skills")).toBe("/Users/t/Documents/skills");
    expect(resolveHomePath("win32", "C:\\Users\\t", "Claude\\skills")).toBe("C:\\Users\\t\\Claude\\skills");
  });
  it("leaves an absolute path untouched", () => {
    expect(resolveHomePath("darwin", "/Users/t", "/opt/skills")).toBe("/opt/skills");
    expect(resolveHomePath("win32", "C:\\Users\\t", "D:\\skills")).toBe("D:\\skills");
  });
  it("refuses a home-relative path that climbs out with .., and ~user", () => {
    expect(() => resolveHomePath("darwin", "/Users/t", "~/../other")).toThrow(/\.\./);
    expect(() => resolveHomePath("darwin", "/Users/t", "a/../../b")).toThrow(/\.\./);
    expect(() => resolveHomePath("darwin", "/Users/t", "~bob/x")).toThrow(/~user/);
    expect(() => resolveHomePath("darwin", "/Users/t", "")).toThrow(/empty/);
  });
});
