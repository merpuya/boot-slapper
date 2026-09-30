import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARITY_MAP, parseBashDoctor } from "./normalize.ts";

const BOOTSTRAP = path.join(homedir(), ".claude", "bootstrap.sh");
// Async on purpose: a blocking spawnSync (~66 s) starves the vitest worker, which then cannot answer the main
// process's onTaskUpdate RPC and prints `Timeout calling "onTaskUpdate"` on every run, passing or failing.
interface Ran { stdout: string; stderr: string; error?: Error }
const run = (cmd: string, args: string[]): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, DEVICE_LABEL: process.env.DEVICE_LABEL ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
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
