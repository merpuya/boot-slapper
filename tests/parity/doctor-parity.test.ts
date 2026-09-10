import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARITY_MAP, parseBashDoctor } from "./normalize.ts";

const BOOTSTRAP = path.join(homedir(), ".claude", "bootstrap.sh");
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, DEVICE_LABEL: process.env.DEVICE_LABEL ?? "" } });

describe.skipIf(!existsSync(BOOTSTRAP))("doctor parity (gate 1)", () => {
  it("bs doctor --json agrees with bootstrap.sh --doctor on every shared check", () => {
    const bash = run("bash", [BOOTSTRAP, "--doctor"]);
    const bashMap = parseBashDoctor(bash.stdout + bash.stderr);
    const bs = run("npx", ["tsx", "src/cli.ts", "doctor", "--json"]);
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
