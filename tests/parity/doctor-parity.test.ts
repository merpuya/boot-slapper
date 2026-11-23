import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARITY_MAP, parseBashDoctor } from "./normalize.ts";

const BOOTSTRAP = path.join(homedir(), ".claude", "bootstrap.sh");
// Async on purpose: a blocking spawnSync (~66 s) starves the vitest worker, which then cannot answer the main
// process's onTaskUpdate RPC and prints `Timeout calling "onTaskUpdate"` on every run, passing or failing.
interface Ran { stdout: string; stderr: string; error?: Error }
const run = (cmd: string, args: string[], home?: string): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, DEVICE_LABEL: process.env.DEVICE_LABEL ?? "", ...(home ? { HOME: home } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", error: Error | undefined;
    const timer = setTimeout(() => { error = new Error(`${cmd} timed out after 120s`); child.kill("SIGKILL"); }, 120_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d)); child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); resolve({ stdout, stderr, error: e }); });
    child.on("close", () => { clearTimeout(timer); resolve({ stdout, stderr, error }); });
  });

describe.skipIf(!existsSync(BOOTSTRAP))("doctor parity (gate 1)", () => {
  it("bs doctor --json agrees with bootstrap.sh --doctor on every shared check", { timeout: 300_000 }, async () => {
    const bash = await run("bash", [BOOTSTRAP, "--doctor"]);
    expect(bash.error, "bootstrap.sh --doctor timed out or failed to spawn").toBeUndefined();
    const bashMap = parseBashDoctor(bash.stdout + bash.stderr);
    const bs = await run("npx", ["tsx", "src/cli.ts", "doctor", "--json"]);
    expect(bs.error, "bs doctor --json timed out or failed to spawn").toBeUndefined();
    const j = JSON.parse(bs.stdout) as { checks: Record<string, Array<{ id: string; status: string }>> };
    const bsMap: Record<string, string> = {};
    for (const [artifact, checks] of Object.entries(j.checks)) for (const c of checks) bsMap[`${artifact}.${c.id}`] = c.status;

    const diffs: string[] = [];
    for (const { id } of PARITY_MAP) {
      const b = bashMap[id], t = bsMap[id];
      if (b === undefined) { diffs.push(`${id}: not found in bash output`); continue; }
      if (t === undefined) { diffs.push(`${id}: not found in bs output`); continue; }
      if (id === "prereqs.node" && b === "warn" && t !== "error") continue;  // bs is stricter on node by design
      if (b !== t) diffs.push(`${id}: bash=${b} bs=${t}`);
    }
    expect(diffs).toEqual([]);
  });
});

// Fixture cases for the settings-template sub-key merges and the claude-remember config (dotclaude apply-settings-template.sh and
// apply-remember-config.sh). Each builds a throwaway HOME holding a git-initialised ~/.claude (the real appliers copied in, a
// purpose-built template) and runs BOTH doctors against it, so nothing here reads or writes the real home directory.
const SCRIPTS = path.join(homedir(), ".claude", "scripts");
const APPLIERS = ["apply-settings-template.sh", "apply-remember-config.sh", "apply-canonical-hooks.sh"];
const FIXTURE_KEY = "ENABLE_FIXTURE_FLAG";
const FIXTURE_TEMPLATE = { permissions: { defaultMode: "auto", allow: ["mcp__fixture__tool"] }, env: { [FIXTURE_KEY]: "0" }, theme: "auto" };
const LOCAL_ENV = { CLAUDE_CODE_ENABLE_TELEMETRY: "1", OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic dGVzdA==,X-Scope-OrgID=fleet one" };
const FIXTURE_IDS = ["claude-config.template-keys", "claude-config.remember-config"];

function fixtureHome(settings: Record<string, unknown>, remember: string | null): string {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "bs-parity-")));
  const claude = path.join(home, ".claude");
  mkdirSync(path.join(claude, "scripts"), { recursive: true });
  for (const f of APPLIERS) copyFileSync(path.join(SCRIPTS, f), path.join(claude, "scripts", f));
  writeFileSync(path.join(claude, "scripts", "settings.template.json"), JSON.stringify(FIXTURE_TEMPLATE, null, 2) + "\n");
  writeFileSync(path.join(claude, "scripts", "canonical-hooks.json"), JSON.stringify({ hooks: {} }) + "\n");
  writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ ...settings, hooks: {} }, null, 2) + "\n");
  spawnSync("git", ["-C", claude, "init", "-q", "-b", "main"], { stdio: "ignore" });
  if (remember !== null) { mkdirSync(path.join(home, ".remember"), { mode: 0o700 }); writeFileSync(path.join(home, ".remember", "config.json"), remember); }
  return home;
}

async function doctorsAgree(home: string): Promise<{ bash: Record<string, string>; bs: Record<string, string> }> {
  const bash = await run("bash", [BOOTSTRAP, "--doctor"], home);
  expect(bash.error, "bootstrap.sh --doctor timed out or failed to spawn").toBeUndefined();
  const all = parseBashDoctor(bash.stdout + bash.stderr);
  const bs = await run("npx", ["tsx", "src/cli.ts", "doctor", "--json"], home);
  expect(bs.error, "bs doctor --json timed out or failed to spawn").toBeUndefined();
  const j = JSON.parse(bs.stdout) as { checks: Record<string, Array<{ id: string; status: string }>> };
  const bsMap: Record<string, string> = {};
  for (const [artifact, checks] of Object.entries(j.checks)) for (const c of checks) bsMap[`${artifact}.${c.id}`] = c.status;
  return { bash: Object.fromEntries(FIXTURE_IDS.map((id) => [id, all[id]])), bs: Object.fromEntries(FIXTURE_IDS.map((id) => [id, bsMap[id]])) };
}

describe.skipIf(!existsSync(BOOTSTRAP) || !APPLIERS.every((f) => existsSync(path.join(SCRIPTS, f))))("doctor parity: settings template sub-keys + remember config (fixtures)", () => {
  const IN_SYNC_REMEMBER = '{"features": {"plugin_promos": false}}\n';
  const cases: Array<[string, Record<string, unknown>, string | null, Record<string, string>]> = [
    ["a missing managed env key", { permissions: { allow: ["mcp__fixture__tool"] }, env: { ...LOCAL_ENV }, theme: "auto" }, IN_SYNC_REMEMBER,
      { "claude-config.template-keys": "error", "claude-config.remember-config": "ok" }],
    ["a local-only env key beside the managed one", { permissions: { allow: ["mcp__fixture__tool", "Bash(ls:*)"] }, env: { ...LOCAL_ENV, [FIXTURE_KEY]: "1" }, theme: "auto" }, IN_SYNC_REMEMBER,
      { "claude-config.template-keys": "ok", "claude-config.remember-config": "ok" }],
    ["no ~/.remember/config.json", { permissions: { allow: ["mcp__fixture__tool"] }, env: { [FIXTURE_KEY]: "0" }, theme: "auto" }, null,
      { "claude-config.template-keys": "ok", "claude-config.remember-config": "error" }],
  ];
  it.each(cases)("bs doctor agrees with bootstrap.sh --doctor: %s", { timeout: 300_000 }, async (_label, settings, remember, expected) => {
    const home = fixtureHome(settings, remember);
    try {
      const { bash, bs } = await doctorsAgree(home);
      expect(bash).toEqual(expected);   // the bash doctor is the reference; the expectation pins the fixture itself
      expect(bs).toEqual(bash);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
