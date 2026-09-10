import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sh = () => readFileSync("install.sh", "utf8");
const ps1 = () => readFileSync("install.ps1", "utf8");
const has = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).status === 0;

describe("install shims", () => {
  it("install.sh: parses, is strict, never sudo, clones the public repo and execs onboard with the caller's args", () => {
    const s = sh();
    expect(s.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain('REPO_URL="https://github.com/merpuya/boot-slapper.git"');
    expect(s).toContain('exec node "$DIR/dist/cli.js" onboard "$@"');
    expect(s).toContain("brew install node");
    expect(s).not.toMatch(/\bsudo\b/);
    if (has("bash")) expect(spawnSync("bash", ["-n", "install.sh"], { encoding: "utf8" }).status).toBe(0);
  });
  it("install.ps1: stops on error, installs node LTS + git via winget, builds, and re-raises bs's exit code", () => {
    const s = ps1();
    expect(s).toContain('$ErrorActionPreference = "Stop"');
    expect(s).toContain("winget install --id OpenJS.NodeJS.LTS");
    expect(s).toContain("winget install --id Git.Git");
    expect(s).toContain("npm ci --no-audit --no-fund");
    expect(s).toContain("exit $LASTEXITCODE");
    if (process.platform === "win32") {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", "$null = [scriptblock]::Create((Get-Content -Raw install.ps1)); exit 0"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    }
  });
});
