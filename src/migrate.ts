import path from "node:path";
import { CHECKLIST_MARKER, firstPartyStore, legacyFacts, renderChecklist } from "./artifacts/legacy-subscription.ts";
import type { Ctx } from "./engine/artifact.ts";
import { scanForSecrets } from "./engine/capture.ts";
import { pj } from "./engine/env.ts";
import { gateLines, managedGate, refusesManaged } from "./engine/managed-gate.ts";
import { resolveHomePath } from "./engine/paths.ts";
import type { Profile } from "./engine/profile.ts";
import type { Sink } from "./ui/headless.ts";

export const EXIT_MANAGED = 4;

/** True when `p` is the store folder or anywhere beneath it (lexical, target-os flavour; case-insensitive on macOS and Windows). */
function insideStore(os: Ctx["env"]["os"], p: string, store: string): boolean {
  const flavour = os === "win32" ? path.win32 : path.posix;
  const fold = (x: string) => (os === "linux" ? x : x.toLowerCase());
  const rel = flavour.relative(fold(flavour.resolve(store)), fold(flavour.resolve(p)));
  const up = rel === ".." || rel.startsWith(`..${flavour.sep}`); // "..x" is a child named ..x, not a parent hop
  return rel === "" || (!up && !flavour.isAbsolute(rel));
}

/**
 * The one `--out` resolver, shared by `bs migrate` and `bs capture`: expands `~` / home-relative forms against the target home,
 * then refuses any folder inside the first-party Claude store. Returns the folder, or the refusal text and exit code to emit.
 */
export function resolveOutDir(ctx: Ctx, out: string): { dir: string } | { error: string; code: number } {
  let dir: string;
  try { dir = resolveHomePath(ctx.env.os, ctx.env.home, out); }
  catch (e) { return { error: `--out: ${(e as Error).message}`, code: 2 }; }
  const store = firstPartyStore(ctx);
  if (insideStore(ctx.env.os, dir, store)) return { error: `refusing --out ${dir}: it is inside Claude's own data folder (${store}). Choose another folder.`, code: 2 };
  return { dir };
}

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
  const resolved = resolveOutDir(ctx, o.out ?? pj(ctx.env.os, ctx.env.home, "Documents", "claude-migration"));
  if ("error" in resolved) { stderr.write(resolved.error); return resolved.code; }
  const dir = resolved.dir;
  const target = pj(ctx.env.os, dir, "instructions.md");
  const existing = await ctx.io.readFile(target);
  if (existing !== null && !existing.startsWith(CHECKLIST_MARKER)) { stderr.write(`${target} already exists and was not written by this tool, so it was left alone. Choose another folder with --out.`); return 1; }
  if (gate.verdict !== "clean") for (const l of gateLines(gate)) stdout.write(l);
  await ctx.io.writeFile(target, md);
  stdout.write(`==> checklist written: ${target}`);
  stdout.write("Your claude.ai account is untouched. Work through the list, and cancel your personal subscription only after you have saved what you need.");
  return 0;
}
