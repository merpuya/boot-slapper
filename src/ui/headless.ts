import type { Check } from "../engine/artifact.ts";
import type { EngineEvent } from "../engine/events.ts";
import { pj, toOs } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import type { Plan } from "../engine/plan.ts";

export interface Sink { write(line: string): void }
const ICON = { ok: "✓", warn: "!", error: "✗" } as const;

export function headlessReporter(sink: Sink): (e: EngineEvent) => void {
  return (e) => {
    switch (e.type) {
      case "artifact:detected": sink.write(`==> ${e.id}: ${e.state.kind}${"details" in e.state && e.state.details?.length ? " — " + e.state.details.join("; ") : e.state.kind === "blocked" ? " — " + e.state.reason : ""}`); break;
      case "artifact:skipped": sink.write(`==> ${e.id}: skipped — ${e.reason}`); break;
      case "step:start": sink.write(`    … ${e.step.title}`); break;
      case "step:done": sink.write(e.ok ? `    ✓ ${e.step.title}` : `    ✗ ${e.step.title} — ${e.error ?? "failed"}`); break;
      case "prompt:needed": sink.write(`    ? ${e.step.title}`); break;
      case "check:result": sink.write(`    ${ICON[e.check.status]} ${e.check.message}`); break;
      case "note": sink.write(`    ${e.level === "info" ? "·" : ICON[e.level]} ${e.message}`); break;
    }
  };
}

export function runLogWriter(io: Io, dir: string, startedAt: Date) {
  const stamp = startedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  // Join with the Io's platform, not the host's — a fake Io on a Windows runner still uses posix paths.
  const file = pj(toOs(io.platform), dir, `${stamp}.jsonl`);
  let chain: Promise<void> = io.mkdirp(dir, { mode: 0o700 });
  return {
    path: file,
    emit(e: EngineEvent) {
      chain = chain.then(async () => {
        const prev = (await io.readFile(file)) ?? "";
        await io.writeFile(file, prev + JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n", { mode: 0o600 });
      });
    },
    done: () => chain,
  };
}

export function renderPlanText(plan: Plan): string {
  const lines: string[] = [];
  for (const p of plan) {
    const d = "details" in p.state && p.state.details?.length ? " — " + p.state.details.join("; ") : p.state.kind === "blocked" ? " — " + p.state.reason : "";
    lines.push(`==> ${p.artifact.id} [${p.artifact.portability}]: ${p.state.kind}${d}`);
    for (const s of p.steps) lines.push(`    → ${s.title}${s.interactive ? " (interactive)" : ""}`);
  }
  return lines.join("\n") + "\n";
}

export function renderChecksText(checks: Record<string, Check[]>): string {
  const lines: string[] = [];
  let failures = 0;
  for (const [id, cs] of Object.entries(checks)) {
    lines.push(`==> ${id}`);
    for (const c of cs) { lines.push(`    ${ICON[c.status]} ${c.message}`); if (c.status === "error") failures++; }
  }
  lines.push(failures ? `==> Doctor: ${failures} check(s) FAILED` : "==> Doctor: all checks passed");
  return lines.join("\n") + "\n";
}
