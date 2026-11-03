import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sh = () => readFileSync("install.sh", "utf8");
const ps1 = () => readFileSync("install.ps1", "utf8");
const has = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).status === 0;

describe("install shims", () => {
  // The syntax checks shell out (bash -n / a cold powershell), which can exceed vitest's 5 s default on Windows.
  it("install.sh: parses, is strict, never sudo, clones the public repo and execs onboard with the caller's args", { timeout: 60_000 }, () => {
    const s = sh();
    expect(s.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain('REPO_URL="https://github.com/merpuya/boot-slapper.git"');
    expect(s).toContain('exec node "$DIR/dist/cli.js" onboard "$@"');
    expect(s).toContain('onboard "$@" </dev/tty');
    expect(s).toContain("brew install node");
    expect(s).not.toMatch(/\bsudo\b/);
    if (has("bash")) expect(spawnSync("bash", ["-n", "install.sh"], { encoding: "utf8" }).status).toBe(0);
  });
  it("install.ps1: stops on error, installs node LTS + git via winget, builds, and re-raises bs's exit code", { timeout: 60_000 }, () => {
    const s = ps1();
    expect(s).toContain('$ErrorActionPreference = "Stop"');
    expect(s).toContain("winget install --id OpenJS.NodeJS.LTS");
    expect(s).toContain("winget install --id Git.Git");
    expect(s).toContain("npm ci --no-audit --no-fund");
    expect(s).toContain('throw "bs onboard exited $LASTEXITCODE"');
    expect(s).not.toMatch(/^\s*exit\b/m);
    if (process.platform === "win32") {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", "$null = [scriptblock]::Create((Get-Content -Raw install.ps1)); exit 0"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    }
  });
  it("install.ps1: probes the Documents root like install.sh (static, every OS)", () => {
    const s = ps1();
    expect(s).toContain("Documents\\Claude\\projects\\boot-slapper");
    expect(s).toContain("$env:USERPROFILE");
    expect(s).toContain("$env:BOOT_SLAPPER_DIR");
  });
  // pwsh/powershell rows: only the windows-latest CI job runs these. The probe block is lifted out of install.ps1 verbatim
  // (from the `$Dir = if` line to the first closing-brace line after it) so no install step (winget/git/npm) runs.
  const dirProbe = () => {
    const lines = ps1().split("\n");
    const start = lines.findIndex((l) => l.includes("$Dir = if"));
    const end = lines.findIndex((l, i) => i > start && /^\s*\}\s*$/.test(l));
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return lines.slice(start, end + 1).join("\n");
  };
  const resolveDir = (layout: { projects?: boolean; documents?: boolean; override?: string }) => {
    const home = mkdtempSync(join(tmpdir(), "bs-ps1-"));
    try {
      if (layout.projects) mkdirSync(join(home, "projects", "boot-slapper", ".git"), { recursive: true });
      if (layout.documents) mkdirSync(join(home, "Documents", "Claude", "projects", "boot-slapper", ".git"), { recursive: true });
      const env: Record<string, string> = { ...(process.env as Record<string, string>), USERPROFILE: home };
      delete env.BOOT_SLAPPER_DIR;
      if (layout.override) env.BOOT_SLAPPER_DIR = layout.override.replace("<home>", home);
      // -EncodedCommand (base64 UTF-16LE) sidesteps Windows argv quoting of the embedded double quotes.
      const script = Buffer.from(`$ErrorActionPreference = 'Stop'\n${dirProbe()}\nWrite-Output $Dir`, "utf16le").toString("base64");
      const r = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", script], { encoding: "utf8", env });
      expect(r.status, r.stderr).toBe(0);
      return { dir: r.stdout.trim(), home };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
  describe.skipIf(process.platform !== "win32")("install.ps1 checkout-root probe (win32 only)", () => {
    it("both roots present: ~\\projects wins", { timeout: 60_000 }, () => {
      const { dir, home } = resolveDir({ projects: true, documents: true });
      expect(dir).toBe(join(home, "projects", "boot-slapper"));
    });
    it("only the Documents root present: it is used", { timeout: 60_000 }, () => {
      const { dir, home } = resolveDir({ documents: true });
      expect(dir).toBe(join(home, "Documents", "Claude", "projects", "boot-slapper"));
    });
    it("neither present: the default ~\\projects path", { timeout: 60_000 }, () => {
      const { dir, home } = resolveDir({});
      expect(dir).toBe(join(home, "projects", "boot-slapper"));
    });
    it("BOOT_SLAPPER_DIR wins even when only the Documents root exists", { timeout: 60_000 }, () => {
      const { dir, home } = resolveDir({ documents: true, override: join("<home>", "elsewhere", "boot-slapper") });
      expect(dir).toBe(join(home, "elsewhere", "boot-slapper"));
    });
  });
});
