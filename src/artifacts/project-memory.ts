import path from "node:path";
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj, type Os } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import { walkFiles } from "../engine/walk.ts";
import { cloneUrl } from "./claude-config.ts";

const ID = "project-memory";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { sshUrl: string; httpsUrl: string; dir?: string }

/** The wired node ports; tracked files of the dotclaude checkout (install.sh §2). Never copied here. */
export const HOOK_SCRIPTS = ["memory-auto-sync.mjs", "load-mecp-context.mjs"] as const;
export interface DeviceConfig { device_label: string; platform: string; mappings: Record<string, string>; [k: string]: unknown }

/** detect → plan channel: State.details prefixes. */
export const D = { clone: "claude-memory-sync repo absent", config: "no device config for", unmapped: "unmapped memory dir(s):" } as const;

/** Device files are committed and shared across machines; the fleet writes C:/Users/… on Windows. */
export const fwd = (p: string) => p.replace(/\\/g, "/");
/** Git Bash script argument: /c/Users/… ; posix paths pass through. */
export const bashPath = (p: string) => fwd(p).replace(/^([A-Za-z]):\//, (_m, d: string) => `/${d.toLowerCase()}/`);
const norm = (p: string, os: string) => { const s = fwd(p).replace(/\/+$/, ""); return os === "win32" ? s.toLowerCase() : s; };
const tail = (s: string) => s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");

/** Longest known logical name that is a substring of the encoded dir (install.sh took the first sorted match; longest avoids `mecp` shadowing `mecp-handoffs`). */
export function guessLogical(encoded: string, known: string[]): string | null {
  let best: string | null = null;
  for (const k of known) if (k && encoded.includes(k) && (best === null || k.length > best.length)) best = k;
  return best;
}

async function readJson(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { const v = JSON.parse(s) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid"; }
  catch { return "invalid"; }
}

interface Candidate { encoded: string; memoryDir: string; guess: string | null }
interface Facts {
  repoDir: string; repoPresent: boolean; scriptsMissing: string[];
  configPath: string; config: DeviceConfig | null | "invalid"; known: string[];
  onDisk: Array<{ encoded: string; memoryDir: string }>;
  unmapped: Candidate[];          // on disk, not in mappings
  mappable: Candidate[];          // unmapped with a guess that is not already a mapping key — the only ones apply adds headlessly
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const repoDir = o.dir ?? pj(env.os, env.home, "projects", "claude-memory-sync");
  const f: Facts = { repoDir, repoPresent: await io.isDir(pj(env.os, repoDir, ".git")), scriptsMissing: [], configPath: pj(env.os, repoDir, "devices", `${env.label}.json`), config: null, known: [], onDisk: [], unmapped: [], mappable: [] };
  for (const s of HOOK_SCRIPTS) if (!(await io.exists(pj(env.os, env.claudeDir, "scripts", s)))) f.scriptsMissing.push(s);
  const projects = pj(env.os, env.claudeDir, "projects");
  for (const enc of (await io.readdir(projects)).sort()) {
    const memoryDir = pj(env.os, projects, enc, "memory");
    if (await io.isDir(memoryDir)) f.onDisk.push({ encoded: enc, memoryDir });
  }
  if (!f.repoPresent) return f;
  for (const n of (await io.readdir(pj(env.os, repoDir, "projects"))).sort()) if (!n.startsWith(".") && (await io.isDir(pj(env.os, repoDir, "projects", n)))) f.known.push(n);
  const raw = await readJson(io, f.configPath);
  f.config = raw === null || raw === "invalid" ? raw : (raw as DeviceConfig);
  const mappings = f.config && f.config !== "invalid" ? (f.config.mappings ?? {}) : {};
  const mapped = new Set(Object.values(mappings).map((v) => norm(String(v), env.os)));
  for (const d of f.onDisk) if (!mapped.has(norm(d.memoryDir, env.os))) f.unmapped.push({ ...d, guess: guessLogical(d.encoded, f.known) });
  f.mappable = f.unmapped.filter((u) => u.guess !== null && !(u.guess in mappings));
  return f;
}

const syncBin = (f: Facts, os: Os) => bashPath(pj(os, f.repoDir, "bin", "sync-memory"));

export const projectMemory: Artifact = {
  id: ID, surfaces: ["code"], portability: "portable", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.repoPresent) return { kind: "absent", details: [`${D.clone} — will clone to ${f.repoDir}`] };
    if (f.config === "invalid") return { kind: "blocked", reason: `devices/${ctx.env.label}.json is not valid JSON — fix it by hand, then re-run` };
    const details: string[] = [];
    if (f.config === null) details.push(`${D.config} '${ctx.env.label}' — will build devices/${ctx.env.label}.json`);
    else if (f.mappable.length) details.push(`${D.unmapped} ${f.mappable.map((u) => u.encoded).join(", ")} — will map into devices/${ctx.env.label}.json`);
    return details.length ? { kind: "drifted", details } : { kind: "present" };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.clone))) steps.push(step("clone", "clone claude-memory-sync to ~/projects/claude-memory-sync"));
    steps.push(step("device-config", "build or extend devices/<label>.json from the memory dirs on this device"));
    steps.push(step("sync", "initial sync: sync-memory push, then pull"));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.clone`: {
          const f = await facts(ctx);
          await io.mkdirp((env.os === "win32" ? path.win32 : path.posix).dirname(f.repoDir));
          const r = await io.exec("git", ["clone", "--quiet", await cloneUrl(io, o.sshUrl, o.httpsUrl), f.repoDir], { env: { GIT_TERMINAL_PROMPT: "0" } });
          if (r.code !== 0) throw new Error(`git clone failed: ${tail(r.stderr)}`);
          break;
        }
        case `${ID}.device-config`: {
          // bootstrap.sh step 6: a brand-new box has no ~/.claude/projects yet; an empty-mappings config is the correct fresh-box state.
          await io.mkdirp(pj(env.os, env.claudeDir, "projects"));
          await io.mkdirp(pj(env.os, env.claudeDir, "logs"));
          const f = await facts(ctx);
          if (f.config === "invalid") throw new Error(`devices/${env.label}.json is not valid JSON — fix it by hand, then re-run`);
          const fresh = f.config === null;
          const cfg: DeviceConfig = f.config ?? { device_label: env.label, platform: env.os, mappings: {} };
          const mappings: Record<string, string> = { ...(cfg.mappings ?? {}) };
          // A fresh config offers every dir (interactive users can name the unguessable ones); an existing one only gets what can be guessed.
          const candidates = fresh ? f.unmapped : f.mappable;
          let added = 0;
          for (const u of candidates) {
            const label = `encoded '${u.encoded}' → logical name (blank to skip)`;
            const logical = ctx.interactive ? (await ctx.prompt.text(label, u.guess ?? "")).trim() : (u.guess ?? "");
            if (!logical) { ctx.emit({ type: "note", level: "warn", message: `${ID}: skipped ${u.encoded} (no logical name)` }); continue; }
            if (logical in mappings) { ctx.emit({ type: "note", level: "warn", message: `${ID}: '${logical}' already maps to ${mappings[logical]} — not remapping to ${u.encoded}` }); continue; }
            mappings[logical] = fwd(u.memoryDir); added++;
          }
          if (!fresh && added === 0) break;
          await io.writeFile(f.configPath, JSON.stringify({ ...cfg, mappings }, null, 2) + "\n");
          ctx.emit({ type: "note", level: "info", message: `${ID}: ${fresh ? "wrote" : "extended"} devices/${env.label}.json (${added} mapping(s) added, ${Object.keys(mappings).length} total)` });
          break;
        }
        case `${ID}.sync`: {
          // Push FIRST: pull mirrors with --delete, and a box whose sync was dead-but-writing loses local-only memory to a pull-only start (2026-08-16).
          const f = await facts(ctx); const bin = syncBin(f, env.os);
          const push = await io.exec("bash", [bin, "--device", env.label, "push"], { timeout: 120_000 });
          if (push.code !== 0) ctx.emit({ type: "note", level: "warn", message: `${ID}: push exited ${push.code}${push.code === 3 ? " (conflicts — see <file>.conflict-<device> sidecars in the repo)" : ""}: ${tail(push.stderr)}` });
          const pull = await io.exec("bash", [bin, "--device", env.label, "pull"], { timeout: 120_000 });
          if (pull.code !== 0) throw new Error(`sync-memory pull failed (exit ${pull.code}): ${tail(pull.stderr)}`);
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const { env, io } = ctx; const out: Check[] = [];
    if (!f.repoPresent) { out.push({ id: "repo", status: "error", message: `claude-memory-sync repo missing at ${f.repoDir} — run bs onboard` }); return out; }
    out.push({ id: "repo", status: "ok", message: "claude-memory-sync repo present" });
    out.push(f.scriptsMissing.length
      ? { id: "hook-scripts", status: "error", message: `hook script(s) missing from ~/.claude/scripts: ${f.scriptsMissing.join(", ")} — owned by dotclaude; check the claude-config artifact` }
      : { id: "hook-scripts", status: "ok", message: "hook scripts present in ~/.claude/scripts (owned by dotclaude)" });
    if (f.config === "invalid") { out.push({ id: "device-config", status: "error", message: `devices/${env.label}.json is not valid JSON — fix it by hand` }); return out; }
    if (f.config === null) { out.push({ id: "device-config", status: "error", message: `no device config for '${env.label}' — run bs onboard` }); return out; }
    out.push({ id: "device-config", status: "ok", message: `device config exists: devices/${env.label}.json` });
    const r = await io.exec("bash", [syncBin(f, env.os), "--device", env.label, "list"], { timeout: 30_000 });
    out.push(r.code === 0 ? { id: "resolves", status: "ok", message: "sync-memory list resolves this device's config" } : { id: "resolves", status: "error", message: "sync-memory list failed — device config unresolvable" });
    const mappedN = Object.keys(f.config.mappings ?? {}).length;
    const un = f.unmapped.map((u) => u.encoded);
    if (mappedN === 0 && un.length) out.push({ id: "coverage", status: "error", message: `device config maps NOTHING but memory dirs exist — sync is dead: ${un.join(" ")} — run bs onboard` });
    else if (un.length) out.push({ id: "coverage", status: "warn", message: `${mappedN} mapped; these memory dirs are NOT synced: ${un.join(" ")}` });
    else out.push({ id: "coverage", status: "ok", message: `all ${mappedN} memory dir(s) on this device are mapped` });
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx); const files: Bundle["files"] = [];
    if (!f.config || f.config === "invalid") return { files, instructions: [`no device config for '${ctx.env.label}' — memory not captured; run bs onboard first`] };
    for (const [logical, dir] of Object.entries(f.config.mappings ?? {})) {
      const local = String(dir);
      for (const rel of await walkFiles(ctx.io, ctx.env.os, local)) {
        const content = await ctx.io.readFile(pj(ctx.env.os, local, ...rel.split("/")));
        if (content !== null) files.push({ path: `memory/${logical}/${rel}`, content });
      }
    }
    return { files, instructions: [] };
  },
};
