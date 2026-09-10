import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import { deepEqual, renderHooks, seedSettings, stableJson, type HooksBlock } from "../engine/settings.ts";

interface Opts { sshUrl: string; httpsUrl: string }
const ID = "claude-config";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });

const norm = (p: string, os: NodeJS.Platform | string) => {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return os === "win32" ? s.toLowerCase().replace(/^\/([a-z])\//, "$1:/") : s;
};

export async function isCheckout(io: Io, dir: string): Promise<boolean> {
  const r = await io.exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return r.code === 0 && norm(r.stdout.trim(), io.platform) === norm(dir, io.platform);
}

/** SSH when a key is loaded, else HTTPS (bootstrap.sh clone_url: ssh -T exits 1 even on success). */
export async function cloneUrl(io: Io, ssh: string, https: string): Promise<string> {
  const r = await io.exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-T", "git@github.com"]);
  return /successfully authenticated/.test(r.stdout + r.stderr) ? ssh : https;
}

const git = (io: Io, dir: string, ...args: string[]) => io.exec("git", ["-C", dir, ...args]);

async function readJsonOrNull(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid";
  } catch { return "invalid"; }
}

interface Facts {
  exists: boolean; checkout: boolean; modified: string[]; deleted: string[]; behind: boolean;
  settings: Record<string, unknown> | null | "invalid"; templateAdded: string[]; templateStale: string[]; hooksDiffer: boolean;
}

async function renderedHooks(ctx: Ctx): Promise<HooksBlock | null> {
  const raw = await ctx.io.readFile(pj(ctx.env.os, ctx.env.claudeDir, "scripts", "canonical-hooks.json"));
  if (raw === null) return null;
  const canonical = (JSON.parse(raw) as { hooks: HooksBlock }).hooks;
  const nodeExe = ctx.env.os === "win32" ? (await ctx.io.which("node")) ?? undefined : undefined;
  return renderHooks(canonical, { platform: ctx.env.os, nodeExe, homeWin: ctx.env.os === "win32" ? ctx.env.home : undefined });
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx;
  const dir = env.claudeDir;
  const f: Facts = { exists: await io.isDir(dir), checkout: false, modified: [], deleted: [], behind: false, settings: null, templateAdded: [], templateStale: [], hooksDiffer: false };
  if (f.exists) {
    f.checkout = await isCheckout(io, dir);
    if (f.checkout) {
      const st = await git(io, dir, "status", "--porcelain");
      for (const line of st.stdout.split(/\r?\n/)) {
        if (!line) continue;
        const code = line.slice(0, 2);
        if (code === "??" || code === "!!") continue;               // untracked / ignored: not tracked drift
        const file = line.slice(3).split(" -> ").pop()!;             // renames: report the new name
        if (code.includes("D")) f.deleted.push(file); else if (code.trim()) f.modified.push(file);
      }
      const head = (await git(io, dir, "rev-parse", "HEAD")).stdout.trim();
      const remote = await git(io, dir, "ls-remote", "origin", "refs/heads/main");
      if (remote.code === 0) f.behind = remote.stdout.split(/\s/)[0] !== head;
      else ctx.emit({ type: "note", level: "warn", message: "claude-config: origin unreachable — skipping the behind-origin check" });
    }
  }
  f.settings = await readJsonOrNull(io, pj(env.os, dir, "settings.json"));
  const tmplRaw = await io.readFile(pj(env.os, dir, "scripts", "settings.template.json"));
  if (tmplRaw !== null && f.settings !== "invalid") {
    const r = seedSettings(f.settings, JSON.parse(tmplRaw));
    f.templateAdded = r.added; f.templateStale = r.stale;
  }
  const hooks = await renderedHooks(ctx);
  if (hooks && f.settings !== "invalid") f.hooksDiffer = !deepEqual((f.settings ?? {}).hooks, hooks);
  return f;
}

export const claudeConfig: Artifact = {
  id: ID, surfaces: ["code"], portability: "portable", requires: ["prereqs"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.exists) return { kind: "absent", details: ["~/.claude absent — will clone"] };
    if (!f.checkout) return { kind: "absent", details: ["~/.claude exists but is not a checkout — will adopt in place"] };
    const details: string[] = [];
    if (f.behind) details.push("behind origin/main — will pull --ff-only");
    if (f.modified.length) details.push(`${f.modified.length} tracked file(s) differ from origin — NOT overwriting: ${f.modified.join(", ")}`);
    if (f.settings === "invalid") details.push("settings.json is not valid JSON");
    if (f.templateAdded.length || f.templateStale.length) details.push(`settings template drift — missing: [${f.templateAdded.join(", ")}] managed drift: [${f.templateStale.join(", ")}]`);
    if (f.hooksDiffer) details.push("hooks block differs from rendered canonical-hooks.json");
    return details.length ? { kind: "drifted", details } : { kind: "present" };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    const d = state.details ?? [];
    if (state.kind === "absent") steps.push(d[0]?.includes("adopt") ? step("adopt", "adopt existing ~/.claude as the dotclaude checkout") : step("clone", "clone dotclaude to ~/.claude"));
    if (d.some((x) => x.startsWith("behind origin"))) steps.push(step("pull", "git pull --ff-only in ~/.claude"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("settings template drift"))) steps.push(step("settings", "seed settings.json from settings.template.json (missing + managed keys only)"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("hooks block differs"))) steps.push(step("hooks", "render canonical-hooks.json into settings.json for this platform"));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx; const dir = env.claudeDir; const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.clone`: {
          const r = await io.exec("git", ["clone", "--quiet", await cloneUrl(io, o.sshUrl, o.httpsUrl), dir]);
          if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim()}`);
          break;
        }
        case `${ID}.adopt`: {
          const url = await cloneUrl(io, o.sshUrl, o.httpsUrl);
          for (const a of [["init", "-q", "-b", "main"], ["remote", "add", "origin", url], ["fetch", "-q", "origin"]]) {
            const r = await git(io, dir, ...a); if (r.code !== 0) throw new Error(`git ${a[0]} failed: ${r.stderr.trim()}`);
          }
          const originMain = (await git(io, dir, "rev-parse", "origin/main")).stdout.trim();
          await git(io, dir, "update-ref", "refs/heads/main", originMain);
          await git(io, dir, "reset", "-q", "--mixed", "HEAD");
          await git(io, dir, "branch", "-q", "--set-upstream-to=origin/main", "main");
          const f = await facts(ctx);
          for (const file of f.deleted) await git(io, dir, "checkout", "-q", "--", file);
          if (f.deleted.length) ctx.emit({ type: "note", level: "info", message: `restored ${f.deleted.length} tracked file(s) missing from ~/.claude` });
          if (f.modified.length) ctx.emit({ type: "note", level: "warn", message: `${f.modified.length} tracked file(s) in ~/.claude differ from origin — NOT overwriting; reconcile via git -C ~/.claude status` });
          else ctx.emit({ type: "note", level: "info", message: "adopted: working tree matches origin/main" });
          break;
        }
        case `${ID}.pull`: {
          const r = await git(io, dir, "pull", "--ff-only", "--quiet");
          if (r.code !== 0) ctx.emit({ type: "note", level: "warn", message: "pull --ff-only failed — reconcile manually (git -C ~/.claude status)" });
          break;
        }
        case `${ID}.settings`: {
          const sp = pj(env.os, dir, "settings.json");
          const current = await readJsonOrNull(io, sp);
          if (current === "invalid") throw new Error("settings.json is not valid JSON — fix it by hand, then re-run");
          const tmpl = await io.readFile(pj(env.os, dir, "scripts", "settings.template.json"));
          if (tmpl === null) { ctx.emit({ type: "note", level: "warn", message: "no settings.template.json; nothing to seed" }); break; }
          const r = seedSettings(current, JSON.parse(tmpl));
          if (!r.added.length && !r.stale.length) break;
          if (current !== null) await io.copyFile(sp, sp + ".bak.pre-settings-template");
          await io.writeFile(sp, stableJson(r.next));
          JSON.parse((await io.readFile(sp))!); // round-trip validation, as the bash applier does
          break;
        }
        case `${ID}.hooks`: {
          const sp = pj(env.os, dir, "settings.json");
          const current = await readJsonOrNull(io, sp);
          if (current === null || current === "invalid") throw new Error("settings.json missing or invalid — the settings step must run first");
          const rendered = await renderedHooks(ctx);
          if (rendered === null) { ctx.emit({ type: "note", level: "warn", message: "no canonical-hooks.json; nothing to apply" }); break; }
          if (deepEqual(current.hooks, rendered)) break;
          await io.copyFile(sp, sp + ".bak.pre-canonical-hooks");
          await io.writeFile(sp, stableJson({ ...current, hooks: rendered }));
          JSON.parse((await io.readFile(sp))!);
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    const out: Check[] = [];
    if (!f.exists || !f.checkout) { out.push({ id: "checkout", status: "error", message: "~/.claude is not a git checkout" }); return out; }
    out.push({ id: "checkout", status: "ok", message: "~/.claude is a git checkout" });
    const n = f.modified.length + f.deleted.length;
    out.push(n === 0 ? { id: "clean", status: "ok", message: "~/.claude clean vs origin" } : { id: "clean", status: "warn", message: `~/.claude has ${n} changed path(s) — git -C ~/.claude status` });
    if (f.settings === null || f.settings === "invalid") { out.push({ id: "settings-valid", status: "error", message: "settings.json missing or invalid" }); return out; }
    out.push({ id: "settings-valid", status: "ok", message: "settings.json is valid JSON" });
    out.push(f.hooksDiffer ? { id: "hooks-match", status: "error", message: "hooks block differs from canonical-hooks.json — run bs onboard" } : { id: "hooks-match", status: "ok", message: "hooks match canonical-hooks.json" });
    const drift = [...f.templateAdded, ...f.templateStale];
    out.push(drift.length ? { id: "template-keys", status: "error", message: `settings template drift: ${drift.join(", ")} — run bs onboard` } : { id: "template-keys", status: "ok", message: "settings.json carries every template key (managed keys in sync)" });
    return out;
  },
};
