import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import {
  bsDir, desktopInstall, desktopRunning, ENTRY_NAME, MIN_DESKTOP_VERSION, ourEntry, readJson, readSidecar,
  runningError, versionAtLeast, writeLibraryEntry, writeSidecar, type OurEntry,
} from "../engine/desktop.ts";
import { pj, type Os } from "../engine/env.ts";
import { defaultAccount, type SecretService } from "../engine/secrets/store.ts";
import { deepEqual } from "../engine/settings.ts";
import { HELPER_MODE, helperPath, renderHeadersHelper } from "./templates/desktop-helpers.ts";

const ID = "desktop-mcp";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { mcpBundle?: string; tokens: Record<string, SecretService> }
export type BundleDoc = { mcpServers?: Record<string, { type?: string; url?: string; headers?: Record<string, string> }> };
export interface ManagedServer { name: string; transport: "http" | "sse"; url: string; oauth?: true; headersHelper?: string; headersHelperTtlSec?: number }
export const D = { helper: "headers helper absent or stale:", servers: "managed MCP servers differ:", entry: "no boot-slapper entry", running: "Claude Desktop is running" } as const;
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/;

/**
 * Desktop entries derived from the tracked Code-surface bundle (~/.claude/mcp/gateway.json): same URLs on both
 * surfaces, never a literal token. `account` (Task 4 addition — see desktop-inference's `defaultAccount(io)`
 * pattern) is baked into a rendered headers helper's retrieval command; omitted here it falls back to the
 * helper's own runtime USER/USERNAME resolution, which is fine for this direct, io-less unit-test entry point.
 */
export function wantedServers(bundle: BundleDoc, o: Opts, os: Os, home: string, account?: string): { servers: ManagedServer[]; helpers: Array<{ path: string; body: string }>; skipped: string[] } {
  const servers: ManagedServer[] = []; const helpers: Array<{ path: string; body: string }> = []; const skipped: string[] = [];
  for (const [name, e] of Object.entries(bundle.mcpServers ?? {})) {
    const type = e.type ?? "http";
    if (!e.url || !["http", "streamable-http", "sse"].includes(type)) { skipped.push(`${name} (no url / ${type})`); continue; }
    const s: ManagedServer = { name, transport: type === "sse" ? "sse" : "http", url: e.url };
    const auth = Object.entries(e.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1];
    if (auth === undefined) { s.oauth = true; servers.push(s); continue; }
    const m = PLACEHOLDER.exec(auth); const service = m ? o.tokens[m[1]] : undefined;
    if (!m || !service) { skipped.push(`${name} (Authorization header without a known \${VAR} placeholder — not copied)`); continue; }
    const path = helperPath(os, home, `desktop-mcp-${name}-headers`);
    helpers.push({ path, body: renderHeadersHelper(os, service, "Authorization", auth.slice(0, m.index), account) });
    s.headersHelper = path; s.headersHelperTtlSec = 3600; servers.push(s);
  }
  return { servers, helpers, skipped };
}

interface Facts {
  installed: boolean; version: string | null; running: boolean; bundlePath: string; bundle: BundleDoc | null | "invalid";
  ours: OurEntry | null | "invalid"; wanted: ReturnType<typeof wantedServers>; staleHelpers: string[]; current: ManagedServer[]; owned: string[]; merged: ManagedServer[]; serversCurrent: boolean;
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const bundlePath = o.mcpBundle ?? pj(env.os, env.claudeDir, "mcp", "gateway.json");
  const rawBundle = await readJson(io, bundlePath);
  const bundle: BundleDoc | null | "invalid" = rawBundle === null || rawBundle === "invalid" ? rawBundle : (rawBundle as unknown as BundleDoc);
  const install = await desktopInstall(io, env.os, env.home);
  const ours = install.installed ? await ourEntry(io, env.os, env.home) : null;
  const account = defaultAccount(io);
  const wanted = wantedServers(bundle && bundle !== "invalid" ? bundle : {}, o, env.os, env.home, account);
  const staleHelpers: string[] = [];
  for (const h of wanted.helpers) if ((await io.readFile(h.path)) !== h.body) staleHelpers.push(h.path);
  const current = (ours && ours !== "invalid" ? ((ours.doc.mcp as { managedServers?: ManagedServer[] } | undefined)?.managedServers ?? []) : []);
  const owned = (await readSidecar(io, env.os, env.home)).servers ?? [];
  const foreign = current.filter((s) => !owned.includes(s.name) && !wanted.servers.some((w) => w.name === s.name));
  const merged = [...foreign, ...wanted.servers];
  return {
    installed: install.installed, version: install.version, running: install.installed ? await desktopRunning(io, env.os) : false,
    bundlePath, bundle, ours, wanted, staleHelpers, current, owned, merged, serversCurrent: deepEqual(current, merged),
  };
}

export const desktopMcp: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "translatable", requires: ["desktop-inference", "claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.installed) return { kind: "blocked", reason: "Claude Desktop not installed — see desktop-inference" };
    if (f.bundle === null) return { kind: "blocked", reason: `${f.bundlePath} missing — it is a tracked dotclaude file; check the claude-config artifact` };
    if (f.bundle === "invalid") return { kind: "blocked", reason: `${f.bundlePath} is not valid JSON — fix it in dotclaude` };
    if (f.ours === "invalid") return { kind: "blocked", reason: "boot-slapper config-library entry is not valid JSON — see desktop-inference" };
    if (f.ours === null) return { kind: "blocked", reason: `${D.entry} yet — desktop-inference must apply first` };
    for (const s of f.wanted.skipped) ctx.emit({ type: "note", level: "warn", message: `${ID}: skipping ${s}` });
    const details: string[] = [];
    for (const h of f.wanted.helpers) if (f.staleHelpers.includes(h.path)) details.push(`${D.helper} ${f.wanted.servers.find((s) => s.headersHelper === h.path)?.name ?? "?"} — will write ${h.path}`);
    if (!f.serversCurrent) details.push(`${D.servers} ${f.wanted.servers.map((s) => s.name).join(", ")} — will write them into the boot-slapper entry`);
    if (details.length && f.running) details.push(`${D.running} — quit it before applying (the configuration is read at launch)`);
    if (!details.length) return { kind: "present" };
    return f.current.length ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.helper))) steps.push(step("helpers", "write the MCP headers helper(s) for Claude Desktop"));
    if (d.some((x) => x.startsWith(D.servers))) steps.push(step("servers", `write MeCP + Open Brain as managed MCP servers in the '${ENTRY_NAME}' entry`));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.helpers`: {
          const f = await facts(ctx);
          for (const h of f.wanted.helpers) { await io.mkdirp(bsDir(env.os, env.home), { mode: 0o700 }); await io.writeFile(h.path, h.body, { mode: HELPER_MODE }); }
          break;
        }
        case `${ID}.servers`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(runningError(ID));
          if (!f.ours || f.ours === "invalid") throw new Error("no boot-slapper entry — run desktop-inference first");
          const mcp = { ...((f.ours.doc.mcp as Record<string, unknown>) ?? {}), managedServers: f.merged };
          await writeLibraryEntry(io, env.os, env.home, f.ours.id, { ...f.ours.doc, mcp });
          await writeSidecar(io, env.os, env.home, { servers: f.wanted.servers.map((x) => x.name) });
          ctx.emit({ type: "note", level: "info", message: `${ID}: wrote ${f.wanted.servers.length} managed server(s) (${f.wanted.servers.map((x) => x.name).join(", ")}) — relaunch Claude Desktop; Open Brain shows a Connect button until authorized (open-brain-auth)` });
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.installed) return [{ id: "installed", status: "error", message: "Claude Desktop not installed" }];
    out.push(f.version && !versionAtLeast(f.version, MIN_DESKTOP_VERSION) ? { id: "version", status: "error", message: `Claude Desktop ${f.version} < ${MIN_DESKTOP_VERSION} — managed MCP servers with helpers need a newer build` } : { id: "version", status: "ok", message: `Claude Desktop ${f.version ?? "(version unknown)"} supports managed MCP servers` });
    if (f.bundle === null || f.bundle === "invalid") { out.push({ id: "bundle", status: "error", message: `${f.bundlePath} missing or invalid` }); return out; }
    for (const w of f.wanted.servers) {
      const cur = f.current.find((s) => s.name === w.name);
      out.push(cur && deepEqual(cur, w) ? { id: `server.${w.name}`, status: "ok", message: `${w.name}: ${w.url} (${w.oauth ? "oauth" : "headers helper"})` } : { id: `server.${w.name}`, status: "error", message: `${w.name} missing or stale in the Claude Desktop configuration — run bs onboard --only ${ID}` });
      if (w.headersHelper) {
        const body = f.wanted.helpers.find((h) => h.path === w.headersHelper)?.body;
        out.push((await ctx.io.readFile(w.headersHelper)) === body ? { id: `helper.${w.name}`, status: "ok", message: `headers helper current: ${w.headersHelper}` } : { id: `helper.${w.name}`, status: "error", message: `headers helper missing or stale: ${w.headersHelper} — run bs onboard` });
        const m = PLACEHOLDER.exec(Object.entries(f.bundle.mcpServers?.[w.name]?.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "");
        const service = m ? o.tokens[m[1]] : undefined;
        if (service) {
          const ref = { service, account: defaultAccount(ctx.io) };
          out.push((await ctx.secrets.get(ref)) !== null ? { id: `secret.${w.name}`, status: "ok", message: `${service} present (${ctx.secrets.describe(ref)})` } : { id: `secret.${w.name}`, status: "warn", message: `${service} missing — bs secrets set ${service} (the helper will fail until then)` });
        }
      }
    }
    return out;
  },

  async capture(): Promise<Bundle> {
    return { files: [], instructions: [`${ID}: regenerated on the target from ~/.claude/mcp/gateway.json (tracked in dotclaude); MeCP needs bs secrets set mecp-device-token, Open Brain is authorized in the app (open-brain-auth)`] };
  },
};
