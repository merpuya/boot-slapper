import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../src/main-guard.ts";

// OS-agnostic fixtures: resolve() anchors to a drive on Windows, and the module URL is derived from
// the same path, so pathToFileURL() round-trips identically on every platform.
const cliPath = resolve("/Users/alex/projects/boot-slapper/dist/cli.js");
const linkPath = resolve("/opt/homebrew/bin/bs");
const mod = pathToFileURL(cliPath).href;

describe("isMainModule", () => {
  it("matches when argv[1] is the module file itself", () => {
    expect(isMainModule(cliPath, mod, (p) => p)).toBe(true);
  });

  it("matches a global bin symlink (npm link / npm i -g) once its real path is resolved", () => {
    // Node resolves symlinks for ESM, so import.meta.url is the real path while argv[1] is the link.
    const realpath = (p: string) => (p === linkPath ? cliPath : p);
    expect(isMainModule(linkPath, mod, realpath)).toBe(true);
  });

  it("keeps the dist/cli.js suffix fallback for either path separator", () => {
    expect(isMainModule("C:\\src\\boot-slapper\\dist\\cli.js", mod, (p) => p)).toBe(true);
    expect(isMainModule("/elsewhere/dist/cli.js", mod, (p) => p)).toBe(true);
  });

  it("is false when imported from a test or another module", () => {
    expect(isMainModule(resolve("/Users/alex/node_modules/vitest/dist/cli.mjs"), mod, (p) => p)).toBe(false);
    expect(isMainModule(undefined, mod, (p) => p)).toBe(false);
  });

  it("tolerates a realpath that throws (dangling link) and falls back to the raw argv", () => {
    const boom = () => { throw new Error("ENOENT"); };
    expect(isMainModule(linkPath, mod, boom)).toBe(false);
  });
});
