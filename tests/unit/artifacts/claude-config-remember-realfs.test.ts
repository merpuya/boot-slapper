import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeConfig } from "../../../src/artifacts/claude-config.ts";
import type { Ctx } from "../../../src/engine/artifact.ts";
import { RealIo } from "../../../src/engine/io.ts";

// The remember applier against a real filesystem, rooted in a temp HOME. Mode bits and the umask are what the in-memory fake cannot
// show; nothing here may touch the real home directory, so the HOME swap is asserted before any write.
describe.skipIf(process.platform === "win32")("claude-config remember step on a real filesystem (temp HOME)", () => {
  let tmp: string; let prevHome: string | undefined; let prevUmask: number;
  beforeEach(() => {
    prevHome = process.env.HOME;
    tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "bs-remember-")));
    process.env.HOME = tmp;
    prevUmask = process.umask(0o022);
  });
  afterEach(() => {
    process.umask(prevUmask);
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    rmSync(tmp, { recursive: true, force: true });
  });
  const ctxFor = (): Ctx => {
    const io = new RealIo();
    expect(io.home).toBe(tmp);                       // the guard: a write below can only land in the temp HOME
    expect(homedir()).toBe(tmp);
    return { env: { os: process.platform as "darwin" | "linux", home: tmp }, io, opts: {}, emit: () => {} } as unknown as Ctx;
  };
  const step = { id: "claude-config.remember", title: "" };
  const cfg = () => path.join(tmp, ".remember", "config.json");

  it("creates a missing ~/.remember at 0700 and the file at 0600, holding only the one key", async () => {
    await claudeConfig.apply(ctxFor(), [step]);
    expect(statSync(path.join(tmp, ".remember")).mode & 0o777).toBe(0o700);
    expect(statSync(cfg()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(cfg(), "utf8"))).toEqual({ features: { plugin_promos: false } });
    await claudeConfig.apply(ctxFor(), [step]);     // idempotent: no backup appears on the second pass
    expect(existsSync(cfg() + ".bak.pre-remember-config")).toBe(false);
  });

  it("an existing ~/.remember keeps its mode; the old config is backed up and every other key survives", async () => {
    mkdirSync(path.join(tmp, ".remember"), { mode: 0o755 });
    const old = '{"timezone": "UTC", "features": {"other_flag": true}}\n';
    writeFileSync(cfg(), old);
    await claudeConfig.apply(ctxFor(), [step]);
    expect(statSync(path.join(tmp, ".remember")).mode & 0o777).toBe(0o755);
    expect(readFileSync(cfg() + ".bak.pre-remember-config", "utf8")).toBe(old);
    expect(JSON.parse(readFileSync(cfg(), "utf8"))).toEqual({ timezone: "UTC", features: { other_flag: true, plugin_promos: false } });
  });

  it("a symlinked config.json is refused and its target is untouched", async () => {
    mkdirSync(path.join(tmp, ".remember"), { mode: 0o700 });
    writeFileSync(path.join(tmp, "elsewhere.json"), "{}\n");
    symlinkSync(path.join(tmp, "elsewhere.json"), cfg());
    await expect(claudeConfig.apply(ctxFor(), [step])).rejects.toThrow(/symlink/);
    expect(readFileSync(path.join(tmp, "elsewhere.json"), "utf8")).toBe("{}\n");
  });
});
