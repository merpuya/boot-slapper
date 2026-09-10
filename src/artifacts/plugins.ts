import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";

const ID = "plugins";
export interface Marketplace { name: string; source: string }
interface Opts { marketplaces: Marketplace[]; plugins: string[] }
export const D = { marketplace: "marketplace absent:", plugin: "plugin absent:" } as const;
const tail = (s: string) => s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");

type KnownMarketplaces = Record<string, { source?: Record<string, unknown>; installLocation?: string }>;
interface InstalledPlugins { version?: number; plugins?: Record<string, Array<{ scope?: string; version?: string; installPath?: string }>> }

/** What `claude plugin marketplace add` would take to recreate a known marketplace. */
export function sourceOf(m: { source?: Record<string, unknown> }): string {
  const s = m.source ?? {};
  return String(s.repo ?? s.url ?? s.path ?? JSON.stringify(s));
}

async function readJson<T>(io: Io, p: string): Promise<T | null> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

interface Facts { cli: boolean; dirExists: boolean; known: KnownMarketplaces; installed: NonNullable<InstalledPlugins["plugins"]>; enabled: Record<string, boolean>; missingMarkets: Marketplace[]; missingPlugins: string[] }

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const dir = pj(env.os, env.claudeDir, "plugins");
  const known = (await readJson<KnownMarketplaces>(io, pj(env.os, dir, "known_marketplaces.json"))) ?? {};
  const installed = (await readJson<InstalledPlugins>(io, pj(env.os, dir, "installed_plugins.json")))?.plugins ?? {};
  const enabled = (await readJson<{ enabledPlugins?: Record<string, boolean> }>(io, pj(env.os, env.claudeDir, "settings.json")))?.enabledPlugins ?? {};
  return {
    cli: (await io.which("claude")) !== null, dirExists: await io.isDir(dir), known, installed, enabled,
    missingMarkets: (o.marketplaces ?? []).filter((m) => !(m.name in known)),
    missingPlugins: (o.plugins ?? []).filter((p) => !(p in installed)),
  };
}

const claude = (io: Io, args: string[]) => io.exec("claude", ["plugin", ...args], { timeout: 300_000 });

export const plugins: Artifact = {
  id: ID, surfaces: ["code"], portability: "translatable", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.cli) return { kind: "blocked", reason: "claude CLI not on PATH — install it (see prereqs), then re-run" };
    const details = [
      ...f.missingMarkets.map((m) => `${D.marketplace} ${m.name} (${m.source}) — will add`),
      ...f.missingPlugins.map((p) => `${D.plugin} ${p} — will install`),
    ];
    if (!details.length) return { kind: "present" };
    return f.dirExists ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    for (const d of state.details ?? []) {
      if (d.startsWith(D.marketplace)) { const name = d.slice(D.marketplace.length).trim().split(" ")[0]; steps.push({ id: `${ID}.marketplace.${name}`, title: `add marketplace ${name}` }); }
      else if (d.startsWith(D.plugin)) { const id = d.slice(D.plugin.length).trim().split(" ")[0]; steps.push({ id: `${ID}.install.${id}`, title: `claude plugin install ${id}` }); }
    }
    return steps;
  },

  async apply(ctx, steps) {
    const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      if (s.id.startsWith(`${ID}.marketplace.`)) {
        const name = s.id.slice(`${ID}.marketplace.`.length);
        const m = (o.marketplaces ?? []).find((x) => x.name === name);
        if (!m) throw new Error(`marketplace ${name} is not in the profile`);
        const r = await claude(ctx.io, ["marketplace", "add", m.source, "--scope", "user"]);
        if (r.code !== 0) throw new Error(`claude plugin marketplace add ${m.source} failed (exit ${r.code}): ${tail(r.stderr)}`);
      } else if (s.id.startsWith(`${ID}.install.`)) {
        const id = s.id.slice(`${ID}.install.`.length);
        const r = await claude(ctx.io, ["install", id, "--scope", "user"]);
        if (r.code !== 0) throw new Error(`claude plugin install ${id} failed (exit ${r.code}): ${tail(r.stderr)}`);
      } else throw new Error(`unknown step ${s.id}`);
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.cli) { out.push({ id: "cli", status: "error", message: "claude CLI not on PATH — plugins cannot be verified or installed" }); return out; }
    out.push({ id: "cli", status: "ok", message: "claude CLI on PATH" });
    for (const m of o.marketplaces ?? []) out.push(m.name in f.known
      ? { id: `marketplace.${m.name}`, status: "ok", message: `marketplace ${m.name} (${sourceOf(f.known[m.name])})` }
      : { id: `marketplace.${m.name}`, status: "error", message: `marketplace ${m.name} missing — run bs onboard` });
    for (const p of o.plugins ?? []) {
      if (!(p in f.installed)) out.push({ id: `plugin.${p}`, status: "error", message: `plugin ${p} not installed — run bs onboard` });
      else if (f.enabled[p] === false) out.push({ id: `plugin.${p}`, status: "warn", message: `plugin ${p} installed but disabled — claude plugin enable ${p} (left as you set it)` });
      else out.push({ id: `plugin.${p}`, status: "ok", message: `plugin ${p} ${f.installed[p][0]?.version ?? ""}`.trimEnd() });
    }
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx);
    const doc = {
      marketplaces: Object.entries(f.known).map(([name, m]) => ({ name, source: sourceOf(m) })),
      plugins: Object.entries(f.installed).flatMap(([id, entries]) => entries.map((e) => ({ id, version: e.version ?? null, scope: e.scope ?? "user", enabled: f.enabled[id] !== false }))),
    };
    return { files: [{ path: "plugins.json", content: JSON.stringify(doc, null, 2) + "\n" }], instructions: [] };
  },
};
