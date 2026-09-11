import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { sha256 } from "../engine/capture.ts";
import { cfgGet, decodeAntDid, desktopDataDir, desktopInstall, ourEntry, readJson, readSidecar, writeSidecar, ORG_SENTINEL } from "../engine/desktop.ts";
import { pj, type Os } from "../engine/env.ts";
import { walkFiles } from "../engine/walk.ts";

const ID = "desktop-skills";
interface Opts { skills: string[] }
export const D = { copy: "skill to copy:", foreign: "skill exists in Cowork but is not managed by boot-slapper:", manifest: "manifest entry missing:" } as const;
export interface ManifestSkill { skillId: string; name: string; description: string; creatorType: string; syncManaged?: boolean; updatedAt: string | null; enabled: boolean }
export interface Manifest { lastUpdated: number; skills: ManifestSkill[] }

/** Cowork's user-skills plugin: <data>/local-agent-mode-sessions/skills-plugin/<org>/<account>/{manifest.json, skills/<name>/SKILL.md} (S1/S2 follow-up, Deviations §4). */
export const skillsPluginDir = (dataDir: string, os: Os, org: string, account: string) => pj(os, dataDir, "local-agent-mode-sessions", "skills-plugin", org, account);

export function skillDescription(skillMd: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (fm) { const m = /^description:\s*(.+)$/m.exec(fm[1]); if (m) return m[1].trim().replace(/^["']|["']$/g, ""); }
  const body = fm ? skillMd.slice(fm[0].length) : skillMd;
  return body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
}

interface SkillFacts { name: string; src: string; files: string[]; hash: string; dst: string; inCowork: boolean; ownedHash: string | null; manifest: ManifestSkill | undefined }
interface Facts { installed: boolean; ran3p: boolean; plugin: string; manifestPath: string; manifest: Manifest | null | "invalid"; skills: SkillFacts[]; missingSources: string[] }

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const data = desktopDataDir(io, env.os, env.home);
  const install = await desktopInstall(io, env.os, env.home);
  const account = decodeAntDid(await io.readFile(pj(env.os, data, "ant-did")));
  const entry = install.installed ? await ourEntry(io, env.os, env.home) : null;
  const org = String((entry && entry !== "invalid" && cfgGet(entry.doc, ["telemetry", "orgUuid"], "deploymentOrganizationUuid")) || ORG_SENTINEL);
  const plugin = skillsPluginDir(data, env.os, org, account ?? "");
  const manifestPath = pj(env.os, plugin, "manifest.json");
  const ran3p = account !== null && (await io.isDir(pj(env.os, plugin, "skills")));
  let manifest: Facts["manifest"] = null;
  if (ran3p) {
    const j = await readJson(io, manifestPath);
    manifest = j === null ? null : j !== "invalid" && Array.isArray((j as { skills?: unknown }).skills) ? (j as unknown as Manifest) : "invalid";
  }
  const owned = (await readSidecar(io, env.os, env.home)).skills ?? {};
  const skills: SkillFacts[] = []; const missingSources: string[] = [];
  for (const name of o.skills ?? []) {
    const src = pj(env.os, env.claudeDir, "skills", name);
    const files = await walkFiles(io, env.os, src);
    if (!files.length) { missingSources.push(name); continue; }
    let acc = "";
    for (const rel of files) acc += `${rel}\0${await io.readFile(pj(env.os, src, ...rel.split("/")))}\0`;
    const dst = pj(env.os, plugin, "skills", name);
    skills.push({ name, src, files, hash: sha256(acc), dst, inCowork: ran3p && (await io.isDir(dst)), ownedHash: owned[name] ?? null, manifest: manifest && manifest !== "invalid" ? manifest.skills.find((s) => s.name === name) : undefined });
  }
  return { installed: install.installed, ran3p, plugin, manifestPath, manifest, skills, missingSources };
}
const foreign = (s: SkillFacts) => s.ownedHash === null && (s.inCowork || s.manifest !== undefined);
const stale = (s: SkillFacts) => s.ownedHash !== null && (s.ownedHash !== s.hash || !s.inCowork);

export const desktopSkills: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "portable", requires: ["claude-config", "desktop-inference"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.installed) return { kind: "blocked", reason: "Claude Desktop not installed — see desktop-inference" };
    if (f.missingSources.length) return { kind: "blocked", reason: `skill(s) not in ~/.claude/skills: ${f.missingSources.join(", ")} — they are tracked in dotclaude; check the claude-config artifact or the profile's desktop-skills list` };
    if (!f.ran3p) return { kind: "blocked", reason: "Cowork has not run in third-party mode on this device yet — launch Claude Desktop once in third-party mode, open Cowork, then re-run" };
    if (f.manifest === "invalid") return { kind: "blocked", reason: `${f.manifestPath} is not valid JSON — Cowork owns it; fix it by hand` };
    const details: string[] = [];
    for (const s of f.skills) {
      if (foreign(s)) details.push(`${D.foreign} ${s.name} — left alone`);
      else if (s.ownedHash === null) details.push(`${D.copy} ${s.name} — will copy to ${s.dst}`);
      else if (stale(s)) details.push(`${D.copy} ${s.name} — source changed, will re-copy to ${s.dst}`);
      else if (s.manifest === undefined) details.push(`${D.manifest} ${s.name} — will add it to Cowork's manifest`);
    }
    if (details.every((d) => d.startsWith(D.foreign))) return { kind: "present" };   // nothing to copy; foreign skills are reported by verify
    return f.skills.some((s) => s.ownedHash !== null) ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    for (const d of state.details ?? []) if (d.startsWith(D.copy)) { const name = d.slice(D.copy.length).trim().split(" ")[0]; steps.push({ id: `${ID}.copy.${name}`, title: `copy skill ${name} into Cowork` }); }
    if ((state.details ?? []).some((d) => d.startsWith(D.copy) || d.startsWith(D.manifest))) steps.push({ id: `${ID}.manifest`, title: "register the copied skills in Cowork's skills manifest" });
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      if (s.id.startsWith(`${ID}.copy.`)) {
        const name = s.id.slice(`${ID}.copy.`.length);
        const f = await facts(ctx); const sk = f.skills.find((x) => x.name === name);
        if (!sk) throw new Error(`skill ${name} is not in the profile or has no files`);
        if (foreign(sk)) throw new Error(`skill ${name} exists in Cowork but was not written by boot-slapper — refusing to overwrite`);
        for (const rel of sk.files) {
          const parts = rel.split("/");
          await io.mkdirp(pj(env.os, sk.dst, ...parts.slice(0, -1)));
          await io.writeFile(pj(env.os, sk.dst, ...parts), (await io.readFile(pj(env.os, sk.src, ...parts))) ?? "");
        }
        const side = await readSidecar(io, env.os, env.home);
        await writeSidecar(io, env.os, env.home, { skills: { ...(side.skills ?? {}), [name]: sk.hash } });
      } else if (s.id === `${ID}.manifest`) {
        const f = await facts(ctx);
        if (f.manifest === "invalid") throw new Error(`${f.manifestPath} is not valid JSON`);
        const m: Manifest = f.manifest ?? { lastUpdated: 0, skills: [] };
        let added = 0;
        for (const sk of f.skills) {
          if (sk.ownedHash === null || sk.manifest !== undefined) continue;
          const desc = skillDescription((await io.readFile(pj(env.os, sk.src, "SKILL.md"))) ?? "");
          m.skills.push({ skillId: sk.name, name: sk.name, description: desc, creatorType: "user", syncManaged: false, updatedAt: new Date().toISOString(), enabled: true }); added++;
        }
        if (added) { m.lastUpdated = Date.now(); await io.writeFile(f.manifestPath, JSON.stringify(m, null, 2) + "\n"); }
        ctx.emit({ type: "note", level: "info", message: `${ID}: ${added} manifest entr${added === 1 ? "y" : "ies"} added — Cowork picks them up at the next session` });
      } else throw new Error(`unknown step ${s.id}`);
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const out: Check[] = [];
    if (!f.installed) return [{ id: "cowork", status: "error", message: "Claude Desktop not installed" }];
    if (!f.ran3p) return [{ id: "cowork", status: "warn", message: "Cowork has not run in third-party mode yet — skills are copied after the first launch" }];
    out.push({ id: "cowork", status: "ok", message: `Cowork skills plugin at ${f.plugin}` });
    for (const s of f.skills) {
      if (foreign(s)) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: present in Cowork but not managed by boot-slapper (uploaded by hand?) — left alone` });
      else if (s.ownedHash === null || !s.inCowork) out.push({ id: `skill.${s.name}`, status: "error", message: `${s.name} not copied into Cowork — run bs onboard --only ${ID}` });
      else if (s.ownedHash !== s.hash) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: source changed since the last copy — run bs onboard --only ${ID}` });
      else if (s.manifest === undefined) out.push({ id: `skill.${s.name}`, status: "warn", message: `${s.name}: copied but missing from Cowork's manifest — run bs onboard --only ${ID}` });
      else out.push({ id: `skill.${s.name}`, status: "ok", message: `${s.name} in Cowork (${s.files.length} file(s))` });
    }
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx); const files: Bundle["files"] = [];
    for (const s of f.skills) for (const rel of s.files) { const c = await ctx.io.readFile(pj(ctx.env.os, s.src, ...rel.split("/"))); if (c !== null) files.push({ path: `desktop-skills/${s.name}/${rel}`, content: c }); }
    return { files, instructions: f.missingSources.length ? [`skills missing from ~/.claude/skills on the source: ${f.missingSources.join(", ")}`] : [] };
  },
};
