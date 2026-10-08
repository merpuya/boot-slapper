import { CHECKLIST_MARKER, legacyFacts, renderChecklist } from "./artifacts/legacy-subscription.ts";
import type { Ctx } from "./engine/artifact.ts";
import { scanForSecrets } from "./engine/capture.ts";
import { pj } from "./engine/env.ts";
import { gateLines, managedGate, refusesManaged } from "./engine/managed-gate.ts";
import type { Profile } from "./engine/profile.ts";
import type { Sink } from "./ui/headless.ts";

export const EXIT_MANAGED = 4;

/**
 * `bs migrate` (spec 2026-09-30 section 4). B1 ships the checklist half only: it reads the machine and writes ONE file, instructions.md,
 * inside the output folder it owns. Nothing is applied and nothing under the first-party Claude store is touched. On a managed
 * (or managed-unknown) box the checklist is still written, with the managed notice, because it is read-only and still useful; the
 * full flow refuses there. There is no override flag.
 */
export async function runMigrate(o: { ctx: Ctx; profile: Profile; checklistOnly: boolean; out?: string; stdout: Sink; stderr: Sink }): Promise<number> {
  const { ctx, profile, stdout, stderr } = o;
  if (!profile.artifacts.some((a) => a.id === "legacy-subscription")) { stderr.write("bs migrate needs --profile cornell-faculty (a profile with the legacy-subscription artifact)"); return 2; }
  const gate = refusesManaged(profile) ? await managedGate(ctx.io, ctx.env.os) : { verdict: "clean" as const, message: null, detail: null };
  if (gate.verdict !== "clean" && !o.checklistOnly) {
    for (const l of gateLines(gate)) stderr.write(l);
    stderr.write("Nothing was changed. You can still run: bs migrate --checklist-only");
    return EXIT_MANAGED;
  }
  if (!o.checklistOnly) {
    stderr.write("The full migrate flow (checklist, pause, then onboard) is not built yet. Run bs migrate --checklist-only to write your save-this-first checklist.");
    return 2;
  }
  const hosted = (profile.options["hosted-connectors"] ?? {}) as { connectors?: string[]; features?: string[] };
  const md = renderChecklist(await legacyFacts(ctx), hosted);
  const hits = scanForSecrets([{ path: "instructions.md", content: md }]);
  if (hits.length) { stderr.write(`refusing to write the checklist: ${hits.length} secret-shaped string(s) (${hits.map((h) => `line ${h.line}, ${h.pattern}`).join("; ")})`); return 1; }
  const dir = o.out ?? pj(ctx.env.os, ctx.env.home, "Documents", "claude-migration");
  const target = pj(ctx.env.os, dir, "instructions.md");
  const existing = await ctx.io.readFile(target);
  if (existing !== null && !existing.startsWith(CHECKLIST_MARKER)) { stderr.write(`${target} already exists and was not written by this tool, so it was left alone. Choose another folder with --out.`); return 1; }
  if (gate.verdict !== "clean") for (const l of gateLines(gate)) stdout.write(l);
  await ctx.io.writeFile(target, md);
  stdout.write(`==> checklist written: ${target}`);
  stdout.write("Your claude.ai account is untouched. Work through the list, and cancel your personal subscription only after you have saved what you need.");
  return 0;
}
