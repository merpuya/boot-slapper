import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import type { ExecOpts, Io } from "../engine/io.ts";
import { deepEqual, REMEMBER_FEATURE, renderHooks, seedRememberConfig, seedSettings, SettingsRefusal, stableJson, type HooksBlock } from "../engine/settings.ts";

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

const git = (io: Io, dir: string, args: string[], opts: ExecOpts = {}) =>
  io.exec("git", ["-C", dir, ...args], { ...opts, env: { GIT_TERMINAL_PROMPT: "0", ...opts.env } });

async function readJsonOrNull(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid";
  } catch { return "invalid"; }
}

/** The claude-remember plugin's user-global config. Outside ~/.claude, so it is checked whether or not settings.json is valid. */
const rememberPath = (ctx: Ctx) => pj(ctx.env.os, ctx.env.home, ".remember", "config.json");
const REMEMBER_LABEL = "~/.remember/config.json";

type RememberFact = { kind: "in-sync" } | { kind: "drift"; message: string } | { kind: "refused"; message: string };

/** apply-remember-config.sh --check: what would change, or why it refuses. Read-only; never creates ~/.remember. */
async function rememberFact(ctx: Ctx): Promise<RememberFact> {
  const p = rememberPath(ctx);
  if ((await ctx.io.lstat(p))?.isSymbolicLink) return { kind: "refused", message: `refusing: ${REMEMBER_LABEL} is a symlink — edit it by hand` };
  const raw = await ctx.io.readFile(p);
  let cfg: Record<string, unknown> | null = null;
  if (raw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (e) { return { kind: "refused", message: `refusing: ${REMEMBER_LABEL} is not valid JSON (${(e as Error).message}) — fix by hand` }; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "refused", message: `refusing: ${REMEMBER_LABEL} is not a JSON object — fix by hand` };
    cfg = parsed as Record<string, unknown>;
  }
  try {
    const r = seedRememberConfig(cfg);
    return r.changed ? { kind: "drift", message: `${REMEMBER_LABEL} ${r.existed ? "lacks" : "missing"} features.${REMEMBER_FEATURE} (would set false)` } : { kind: "in-sync" };
  } catch (e) {
    if (e instanceof SettingsRefusal) return { kind: "refused", message: e.message };
    throw e;
  }
}

interface Facts {
  exists: boolean; checkout: boolean; modified: string[]; deleted: string[]; untracked: string[]; behind: boolean;
  settings: Record<string, unknown> | null | "invalid"; templateAdded: string[]; templateStale: string[]; templateEnv: string[]; templateAllow: string[];
  /** seedSettings refused (non-object env / permissions, non-list allow): fix by hand, so no settings step is planned. */
  templateRefusal: string | null; hooksDiffer: boolean; remember: RememberFact;
}

function rememberDetails(f: Facts): string[] {
  if (f.remember.kind === "drift") return [`remember config drift: ${f.remember.message}`];
  if (f.remember.kind === "refused") return [`remember config refused: ${f.remember.message}`];
  return [];
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
  const f: Facts = { exists: await io.isDir(dir), checkout: false, modified: [], deleted: [], untracked: [], behind: false, settings: null, templateAdded: [], templateStale: [], templateEnv: [], templateAllow: [], templateRefusal: null, hooksDiffer: false, remember: await rememberFact(ctx) };
  if (f.exists) {
    f.checkout = await isCheckout(io, dir);
    if (f.checkout) {
      // -z: NUL-terminated entries with the path verbatim. Without it git C-quotes a path holding a space or a non-ASCII byte,
      // and the quoted string is not a path `git checkout --` can find (adopt left "…/sp ace.md" unrestored, 2026-11-15).
      const entries = (await git(io, dir, ["status", "--porcelain", "-z"])).stdout.split("\0");
      for (let i = 0; i < entries.length; i++) {
        const line = entries[i];
        if (!line) continue;
        const code = line.slice(0, 2);
        const file = line.slice(3);                                  // renames: this is the new name…
        if (/[RC]/.test(code)) i++;                                  // …and the old one follows as its own entry
        // Untracked paths are not drift the pull step can act on, but verify's "clean vs origin" counts them like
        // bootstrap.sh --doctor does: a fresh clone would lose them (e.g. handoff notes not yet committed). Ignored (!!) never show.
        if (code === "??") { f.untracked.push(file); continue; }
        if (code === "!!") continue;
        if (code.includes("D")) f.deleted.push(file); else if (code.trim()) f.modified.push(file);
      }
      const head = (await git(io, dir, ["rev-parse", "HEAD"])).stdout.trim();
      const remote = await git(io, dir, ["ls-remote", "origin", "refs/heads/main"], { timeout: 10_000 });
      if (remote.code === 0 && remote.stdout.trim()) f.behind = remote.stdout.split(/\s/)[0] !== head;
      else if (remote.code !== 0) ctx.emit({ type: "note", level: "warn", message: "claude-config: origin unreachable — skipping the behind-origin check" });
    }
  }
  f.settings = await readJsonOrNull(io, pj(env.os, dir, "settings.json"));
  const tmplRaw = await io.readFile(pj(env.os, dir, "scripts", "settings.template.json"));
  if (tmplRaw !== null && f.settings !== "invalid") {
    try {
      const r = seedSettings(f.settings, JSON.parse(tmplRaw));
      f.templateAdded = r.added; f.templateStale = r.stale; f.templateEnv = r.envAdded; f.templateAllow = r.allowAdded;
    } catch (e) {
      if (!(e instanceof SettingsRefusal)) throw e;
      f.templateRefusal = e.message;
    }
  }
  const hooks = await renderedHooks(ctx);
  if (hooks && f.settings !== "invalid") f.hooksDiffer = !deepEqual((f.settings ?? {}).hooks, hooks);
  return f;
}

export const claudeConfig: Artifact = {
  id: ID, surfaces: ["code"], portability: "portable", requires: ["prereqs"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    const remember = rememberDetails(f);
    if (!f.exists) return { kind: "absent", details: ["~/.claude absent — will clone", ...remember] };
    if (!f.checkout) return { kind: "absent", details: ["~/.claude exists but is not a checkout — will adopt in place", ...remember] };
    const details: string[] = [];
    if (f.behind) details.push("behind origin/main — will pull --ff-only");
    if (f.modified.length) details.push(`${f.modified.length} tracked file(s) differ from origin — NOT overwriting: ${f.modified.join(", ")}`);
    if (f.settings === "invalid") details.push("settings.json is not valid JSON");
    if (f.templateRefusal) details.push(`settings template refused: ${f.templateRefusal}`);
    else if (f.templateAdded.length || f.templateStale.length || f.templateEnv.length || f.templateAllow.length) {
      details.push(`settings template drift — missing: [${f.templateAdded.join(", ")}] managed drift: [${f.templateStale.join(", ")}]`
        + (f.templateEnv.length ? ` env: [${f.templateEnv.join(", ")}]` : "") + (f.templateAllow.length ? ` allow: [${f.templateAllow.join(", ")}]` : ""));
    }
    if (f.hooksDiffer) details.push("hooks block differs from rendered canonical-hooks.json");
    details.push(...remember);
    return details.length ? { kind: "drifted", details } : { kind: "present" };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    const d = state.details ?? [];
    if (state.kind === "absent") steps.push(d[0]?.includes("adopt") ? step("adopt", "adopt existing ~/.claude as the dotclaude checkout") : step("clone", "clone dotclaude to ~/.claude"));
    if (d.some((x) => x.startsWith("behind origin"))) steps.push(step("pull", "git pull --ff-only in ~/.claude"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("settings template drift"))) steps.push(step("settings", "seed settings.json from settings.template.json (missing + managed keys, env sub-keys, permissions.allow entries)"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("hooks block differs"))) steps.push(step("hooks", "render canonical-hooks.json into settings.json for this platform"));
    if (d.some((x) => x.startsWith("remember config drift"))) steps.push(step("remember", "set features.plugin_promos=false in ~/.remember/config.json (add-only)"));
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
            const r = await git(io, dir, a); if (r.code !== 0) throw new Error(`git ${a[0]} failed: ${r.stderr.trim()}`);
          }
          const originMain = (await git(io, dir, ["rev-parse", "origin/main"])).stdout.trim();
          await git(io, dir, ["update-ref", "refs/heads/main", originMain]);
          await git(io, dir, ["reset", "-q", "--mixed", "HEAD"]);
          await git(io, dir, ["branch", "-q", "--set-upstream-to=origin/main", "main"]);
          const f = await facts(ctx);
          for (const file of f.deleted) await git(io, dir, ["checkout", "-q", "--", file]);
          if (f.deleted.length) ctx.emit({ type: "note", level: "info", message: `restored ${f.deleted.length} tracked file(s) missing from ~/.claude` });
          if (f.modified.length) ctx.emit({ type: "note", level: "warn", message: `${f.modified.length} tracked file(s) in ~/.claude differ from origin — NOT overwriting; reconcile via git -C ~/.claude status` });
          else ctx.emit({ type: "note", level: "info", message: "adopted: working tree matches origin/main" });
          break;
        }
        case `${ID}.pull`: {
          const r = await git(io, dir, ["pull", "--ff-only", "--quiet"]);
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
          if (!r.added.length && !r.stale.length && !r.envAdded.length && !r.allowAdded.length) break;
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
        case `${ID}.remember`: {
          const p = rememberPath(ctx);
          const fact = await rememberFact(ctx);
          if (fact.kind === "refused") throw new Error(fact.message);
          if (fact.kind === "in-sync") break;
          const raw = await io.readFile(p);
          const r = seedRememberConfig(raw === null ? null : (JSON.parse(raw) as Record<string, unknown>));
          // The plugin keeps ~/.remember private; a directory created here must not be looser than 0700 (dotclaude 0029099).
          await io.mkdirp(pj(env.os, env.home, ".remember"), { mode: 0o700 });
          if (raw !== null) await io.copyFile(p, p + ".bak.pre-remember-config");
          await io.writeFile(p, stableJson(r.next), { mode: 0o600 });
          JSON.parse((await io.readFile(p))!); // round-trip validation, as the bash applier does
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    const out: Check[] = [];
    // bootstrap.sh --doctor checks ~/.remember/config.json outside the settings.json branch, so every return path carries it.
    const rememberCheck = (): Check => f.remember.kind === "in-sync"
      ? { id: "remember-config", status: "ok", message: `remember config carries the managed key (features.${REMEMBER_FEATURE})` }
      : { id: "remember-config", status: "error", message: `remember config drift: ${f.remember.message} — run bs onboard` };
    if (!f.exists || !f.checkout) { out.push({ id: "checkout", status: "error", message: "~/.claude is not a git checkout" }, rememberCheck()); return out; }
    out.push({ id: "checkout", status: "ok", message: "~/.claude is a git checkout" });
    const n = f.modified.length + f.deleted.length + f.untracked.length;
    out.push(n === 0 ? { id: "clean", status: "ok", message: "~/.claude clean vs origin" } : { id: "clean", status: "warn", message: `~/.claude has ${n} changed path(s) — git -C ~/.claude status` });
    if (f.settings === null || f.settings === "invalid") { out.push({ id: "settings-valid", status: "error", message: "settings.json missing or invalid" }, rememberCheck()); return out; }
    out.push({ id: "settings-valid", status: "ok", message: "settings.json is valid JSON" });
    out.push(f.hooksDiffer ? { id: "hooks-match", status: "error", message: "hooks block differs from canonical-hooks.json — run bs onboard" } : { id: "hooks-match", status: "ok", message: "hooks match canonical-hooks.json" });
    const drift = [...f.templateAdded, ...f.templateStale, ...f.templateEnv.map((k) => `env.${k}`), ...f.templateAllow.map((e) => `permissions.allow ${e}`)];
    if (f.templateRefusal) out.push({ id: "template-keys", status: "error", message: `settings template drift: ${f.templateRefusal}` });
    else out.push(drift.length ? { id: "template-keys", status: "error", message: `settings template drift: ${drift.join(", ")} — run bs onboard` } : { id: "template-keys", status: "ok", message: "settings.json carries every template key (managed keys in sync)" });
    out.push(rememberCheck());
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const { io, env } = ctx; const dir = env.claudeDir;
    if (!(await isCheckout(io, dir))) return { files: [], instructions: ["~/.claude is not a dotclaude checkout — nothing captured; the target clones dotclaude itself (bs onboard)"] };
    const ls = await git(io, dir, ["ls-files", "-z"]);
    if (ls.code !== 0) throw new Error(`git ls-files failed: ${ls.stderr.trim()}`);
    const files: Bundle["files"] = [];
    for (const rel of ls.stdout.split("\0").filter(Boolean)) {
      const content = await io.readFile(pj(env.os, dir, ...rel.split("/")));
      if (content !== null) files.push({ path: `claude-config/${rel}`, content });     // a tracked-but-deleted file is simply not bundled
    }
    return { files, instructions: [] };
  },
};
