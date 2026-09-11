import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import {
  bsDir, cfgGet, desktopInstall, desktopRunning, managedSources, managedTakeover, MIN_DESKTOP_VERSION, newEntryId, ourEntry, readLibraryMeta, readLibraryEntry,
  runningError, upsertMeta, versionAtLeast, writeLibraryEntry, writeSidecar, ENTRY_NAME, type DesktopInstall, type OurEntry,
} from "../engine/desktop.ts";
import { defaultAccount } from "../engine/secrets/store.ts";
import { deepEqual } from "../engine/settings.ts";
import { HELPER_MODE, helperPath, renderCredentialHelper } from "./templates/desktop-helpers.ts";

const ID = "desktop-inference";
export const HELPER_NAME = "desktop-inference-credential";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { baseUrl: string; authScheme?: "bearer" | "x-api-key" }

export const D = {
  helper: "credential helper absent or stale", entry: "no boot-slapper entry", stale: "boot-slapper entry differs",
  notApplied: "boot-slapper entry is not the applied configuration", running: "Claude Desktop is running",
} as const;
const SECRET = "cornell-ai-gateway" as const;
const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** The nested v2 document boot-slapper owns. desktop-mcp adds `mcp.managedServers` to the same entry; keys outside these three are never touched here. */
export function wantedDoc(o: Opts, helper: string): Record<string, unknown> {
  return {
    $schemaVersion: 2,
    inference: { provider: "gateway", baseUrl: o.baseUrl, credential: { kind: "helper-script", command: helper, ttlSec: 3600, authScheme: o.authScheme ?? "bearer" } },
    models: { discoveryEnabled: true },
    telemetry: { disableNonessential: true, disableNonessentialServices: true },
  };
}
const OWNED = ["$schemaVersion", "inference"] as const;
function merged(existing: Record<string, unknown>, wanted: Record<string, unknown>): Record<string, unknown> {
  const models = { ...((existing.models as Record<string, unknown>) ?? {}), ...(wanted.models as Record<string, unknown>) };
  const telemetry = { ...((existing.telemetry as Record<string, unknown>) ?? {}), ...(wanted.telemetry as Record<string, unknown>) };
  const out: Record<string, unknown> = { ...existing, models, telemetry };
  for (const k of OWNED) out[k] = wanted[k];
  return out;
}

interface Facts {
  install: DesktopInstall; versionOld: boolean; takeover: string | null; managedKeys: number; running: boolean;
  ours: OurEntry | null | "invalid"; adopted: { name: string; baseUrl: string } | null;
  helper: string; helperBody: string; helperCurrent: boolean; wanted: Record<string, unknown>; docCurrent: boolean;
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const install = await desktopInstall(io, env.os, env.home);
  const sources = install.installed ? await managedSources(io, env.os) : [];
  const helper = helperPath(env.os, env.home, HELPER_NAME);
  const account = defaultAccount(io);
  const helperBody = renderCredentialHelper(env.os, SECRET, account);
  const wanted = wantedDoc(o, helper);
  const ours = install.installed ? await ourEntry(io, env.os, env.home) : null;
  let adopted: Facts["adopted"] = null;
  const meta = install.installed ? await readLibraryMeta(io, env.os, env.home) : null;
  if (meta && meta !== "invalid" && !(ours && ours !== "invalid" && ours.applied)) {
    const applied = meta.entries.find((e) => e.id === meta.appliedId);
    const doc = applied ? await readLibraryEntry(io, env.os, env.home, applied.id) : null;
    if (applied && doc && doc !== "invalid" && cfgGet(doc, ["inference", "provider"], "inferenceProvider") === "gateway") {
      const base = String(cfgGet(doc, ["inference", "baseUrl"], "inferenceGatewayBaseUrl") ?? "");
      const cred = cfgGet(doc, ["inference", "credential", "kind"], "inferenceCredentialKind") ?? doc.inferenceGatewayApiKey ?? doc.inferenceCredentialHelper;
      if (trimSlash(base) === trimSlash(o.baseUrl) && cred !== undefined && applied.name !== ENTRY_NAME) adopted = { name: applied.name, baseUrl: base };
    }
  }
  const docCurrent = ours !== null && ours !== "invalid" && deepEqual(merged(ours.doc, wanted), ours.doc);
  return {
    install, versionOld: install.version !== null && !versionAtLeast(install.version, MIN_DESKTOP_VERSION),
    takeover: managedTakeover(sources), managedKeys: sources.reduce((n, s) => n + s.keys.length, 0),
    running: install.installed ? await desktopRunning(io, env.os) : false,
    ours, adopted, helper, helperBody, helperCurrent: (await io.readFile(helper)) === helperBody, wanted, docCurrent,
  };
}

function blockedReason(f: Facts, o: Opts): string | null {
  if (!f.install.installed) return `Claude Desktop not installed — https://claude.com/download (macOS .dmg; Windows .msix — the .exe installer has no Cowork)`;
  if (f.versionOld) return `Claude Desktop ${f.install.version} < ${MIN_DESKTOP_VERSION} — update it, then re-run`;
  if (f.takeover) return `managed configuration owns Claude Desktop (${f.takeover}) — the local config library is ignored. Ask IT for the gateway profile, or check Developer → Configure Third-Party Inference… (read-only there): provider gateway, base URL ${o.baseUrl}, credential via bs secrets check ${SECRET}`;
  if (f.ours === "invalid") return "a boot-slapper config-library entry or _meta.json is not valid JSON — fix or delete it by hand, then re-run";
  return null;
}

export const desktopInference: Artifact = {
  id: ID, surfaces: ["desktop"], portability: "translatable", requires: ["prereqs", "secrets"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts;
    const blocked = blockedReason(f, o);
    if (blocked) return { kind: "blocked", reason: blocked };
    if (f.adopted) return { kind: "present" };
    const details: string[] = [];
    if (!f.helperCurrent) details.push(`${D.helper} — will write ${f.helper}`);
    if (f.ours === null) details.push(`${D.entry} — will add an entry named '${ENTRY_NAME}' and apply it (existing entries untouched)`);
    else if (f.ours !== "invalid") {
      if (!f.docCurrent) details.push(`${D.stale} — will rewrite the inference/models/telemetry keys`);
      if (!f.ours.applied) details.push(`${D.notApplied} — will apply it`);
    }
    if (details.length && f.running) details.push(`${D.running} — quit it before applying (the configuration is read at launch)`);
    if (!details.length) return { kind: "present" };
    return f.ours === null ? { kind: "absent", details } : { kind: "drifted", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.helper))) steps.push(step("helper", "write the gateway credential helper for Claude Desktop"));
    if (d.some((x) => x.startsWith(D.entry) || x.startsWith(D.stale))) steps.push(step("entry", `write the '${ENTRY_NAME}' configuration entry (gateway + credential helper)`));
    if (d.some((x) => x.startsWith(D.entry) || x.startsWith(D.notApplied))) steps.push(step("apply-entry", `make '${ENTRY_NAME}' the applied Claude Desktop configuration`));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.helper`: {
          const f = await facts(ctx);
          await io.mkdirp(bsDir(env.os, env.home), { mode: 0o700 });
          await io.writeFile(f.helper, f.helperBody, { mode: HELPER_MODE });
          break;
        }
        case `${ID}.entry`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(runningError(ID));
          if (f.ours === "invalid") throw new Error("boot-slapper entry is not valid JSON — fix or delete it by hand, then re-run");
          const id = f.ours?.id ?? newEntryId();
          await writeLibraryEntry(io, env.os, env.home, id, f.ours ? merged(f.ours.doc, f.wanted) : f.wanted);
          await upsertMeta(io, env.os, env.home, { id, name: ENTRY_NAME }, false);
          await writeSidecar(io, env.os, env.home, { entryId: id });
          ctx.emit({ type: "note", level: "info", message: `${ID}: ${f.ours ? "rewrote" : "added"} config-library entry '${ENTRY_NAME}' (${id})` });
          break;
        }
        case `${ID}.apply-entry`: {
          const f = await facts(ctx);
          if (f.running) throw new Error(runningError(ID));
          if (!f.ours || f.ours === "invalid") throw new Error("no boot-slapper entry — the entry step must run first");
          await upsertMeta(io, env.os, env.home, { id: f.ours.id, name: ENTRY_NAME }, true);
          ctx.emit({ type: "note", level: "info", message: `${ID}: '${ENTRY_NAME}' is now the applied configuration — relaunch Claude Desktop and choose the third-party option on the sign-in screen` });
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.install.installed) { out.push({ id: "installed", status: "error", message: `Claude Desktop not installed (${f.install.path}) — https://claude.com/download` }); return out; }
    out.push({ id: "installed", status: "ok", message: `Claude Desktop at ${f.install.path}` });
    out.push(f.versionOld ? { id: "version", status: "error", message: `Claude Desktop ${f.install.version} < ${MIN_DESKTOP_VERSION}` }
      : f.install.version ? { id: "version", status: "ok", message: `Claude Desktop ${f.install.version} (≥ ${MIN_DESKTOP_VERSION})` } : { id: "version", status: "warn", message: "Claude Desktop version unknown — Help → Troubleshooting → Copy Managed Configuration Report shows it" });
    out.push(f.takeover ? { id: "managed", status: "error", message: `managed configuration owns Claude Desktop: ${f.takeover} — local settings are ignored` }
      : { id: "managed", status: "ok", message: f.managedKeys ? `no managed takeover (${f.managedKeys} app-behavior key(s) managed by MDM)` : "no managed configuration present" });
    if (f.adopted) out.push({ id: "entry", status: "ok", message: `adopted the applied configuration '${f.adopted.name}' (gateway, ${f.adopted.baseUrl}) — not managed by boot-slapper` });
    else if (f.ours && f.ours !== "invalid" && f.ours.applied && f.docCurrent) out.push({ id: "entry", status: "ok", message: `boot-slapper entry applied (${f.ours.id}) — gateway ${o.baseUrl}, credential helper` });
    else out.push({ id: "entry", status: "error", message: f.ours === "invalid" ? "boot-slapper config-library entry is not valid JSON" : `Claude Desktop is not configured for the gateway — run bs onboard --only ${ID}` });
    if (!f.adopted) out.push(f.helperCurrent ? { id: "helper", status: "ok", message: `credential helper current: ${f.helper}` } : { id: "helper", status: "error", message: `credential helper missing or stale: ${f.helper} — run bs onboard` });
    const ref = { service: SECRET, account: defaultAccount(ctx.io) };
    const key = await ctx.secrets.get(ref);
    out.push(key !== null ? { id: "secret", status: "ok", message: `gateway key present (${ctx.secrets.describe(ref)})` } : { id: "secret", status: "error", message: `gateway key missing — bs secrets set ${SECRET}` });
    if (key === null) { out.push({ id: "models", status: "warn", message: "gateway not probed — no key in the store" }); return out; }
    const url = `${trimSlash(o.baseUrl)}/v1/models`;
    const headers: Record<string, string> = (o.authScheme ?? "bearer") === "bearer" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key };   // in-process only; never logged
    const r = await ctx.io.fetch(url, { headers, timeout: 15_000 });
    if (r.status === 200) {
      let n = -1; try { const j = JSON.parse(r.body) as { data?: unknown[] }; n = Array.isArray(j.data) ? j.data.length : -1; } catch { n = -1; }
      out.push(n >= 0 ? { id: "models", status: "ok", message: `gateway ${trimSlash(o.baseUrl)} lists ${n} model(s)` } : { id: "models", status: "warn", message: `gateway ${trimSlash(o.baseUrl)} answered 200 without a model list — set inferenceModels by hand if the picker is empty` });
    } else if (r.status === 401 || r.status === 403) out.push({ id: "models", status: "error", message: `gateway rejected the stored key (HTTP ${r.status}) — bs secrets set ${SECRET}` });
    else if (r.status === 0) out.push({ id: "models", status: "warn", message: `gateway unreachable: ${r.body.slice(0, 120)}` });
    else out.push({ id: "models", status: "warn", message: `gateway answered HTTP ${r.status} to GET /v1/models — model discovery may not work; set inferenceModels by hand` });
    return out;
  },

  async capture(): Promise<Bundle> {
    return { files: [], instructions: [`${ID}: regenerated on the target by bs onboard (config entry + credential helper); the gateway key comes from bs secrets set ${SECRET}`] };
  },
};
