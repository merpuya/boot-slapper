import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import {
  adoptedEntry, appliedEntry, bsDir, cfgGet, desktopInstall, desktopRunning, managedSources, managedTakeover, MIN_DESKTOP_VERSION, newEntryId, ourEntry,
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

/**
 * The **v1 flat** document boot-slapper owns. desktop-mcp adds `managedMcpServers` to the same entry; keys
 * outside `OWNED` are never touched here.
 *
 * Flat, not nested v2, because v2 is not accepted by any shipping build we have seen: S1 (2026-09-10)
 * *inferred* both shapes from the bootstrap schema doc and called v2 "what the app's own JSON export
 * writes", and boot-slapper wrote v2 on that basis for a week without ever putting one on a real box.
 * S4 (2026-09-18, yogaNovo, Desktop 2.2553.0.0) did, and the app discarded every nested key by name —
 * `Ignoring local configuration value "inference": not a recognized configuration key`, then
 * `mcpServerCount: 0`. The flat spellings below are S1 §"Keys the owner profile needs" and are also what
 * the app itself writes when the owner configures inference in the in-app window. Readers stay
 * shape-agnostic via `cfgGet`, so an entry the app wrote in either shape is still understood.
 */
export function wantedDoc(o: Opts, helper: string): Record<string, unknown> {
  return {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: o.baseUrl,
    inferenceGatewayAuthScheme: o.authScheme ?? "bearer",
    inferenceCredentialKind: "helper-script",
    inferenceCredentialHelper: helper,
    inferenceCredentialHelperTtlSec: 3600,
    modelDiscoveryEnabled: true,
    disableNonessentialTelemetry: true,
    disableNonessentialServices: true,
  };
}
/**
 * Every key `wantedDoc` emits is owned outright. The nested shape needed a per-cluster merge (`models` and
 * `telemetry` were objects the user or the app could also hold keys in); flat keys are scalars, so a plain
 * overwrite is the whole story and anything else in the document — including a stale nested v2 block the
 * app ignores — is left as it was found.
 */
const OWNED = Object.keys(wantedDoc({ baseUrl: "" }, "")) as ReadonlyArray<string>;
function merged(existing: Record<string, unknown>, wanted: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const k of OWNED) out[k] = wanted[k];
  return out;
}
/**
 * Owned keys the app's in-app apply drops because its form model does not carry them (mac-studio, 2026-09-24,
 * Desktop 2.7032.0: *Apply Changes* re-serialized our fresh entry, added its default keys, normalized `oauth`, and
 * removed exactly these two — inference kept working through the helper). Their absence therefore means the app
 * default, and it is compared as such. `merged` still writes them; the app removing them again is not drift.
 * Same rule as `desktop-mcp`'s `sameServer`: we own the fact, the app owns the spelling.
 */
const APP_DEFAULTED: Readonly<Record<string, unknown>> = { inferenceGatewayAuthScheme: "bearer", inferenceCredentialHelperTtlSec: 3600 };
/** Does `doc` carry every owned fact `wanted` asks for, reading an app-dropped key as the app default? */
export function docSatisfies(doc: Record<string, unknown>, wanted: Record<string, unknown>): boolean {
  return OWNED.every((k) => deepEqual(k in doc ? doc[k] : APP_DEFAULTED[k], wanted[k]));
}

interface Facts {
  install: DesktopInstall; versionOld: boolean; takeover: string | null; managedKeys: number; running: boolean;
  ours: OurEntry | null | "invalid"; adopted: { name: string; baseUrl: string } | null;
  helper: string; helperBody: string; helperCurrent: boolean; wanted: Record<string, unknown>; docCurrent: boolean;
  /** Is the gateway key actually in the store? The helper can only read what is there. */
  haveSecret: boolean;
  /** A credential the app is using right now that our write would replace: a static key, or someone else's helper. */
  liveCredential: string | null;
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
  const adopted = install.installed ? adoptedEntry(await appliedEntry(io, env.os, env.home), o.baseUrl) : null;
  const docCurrent = ours !== null && ours !== "invalid" && docSatisfies(ours.doc, wanted);
  const haveSecret = (await ctx.secrets.get({ service: SECRET, account })) !== null;   // in-process read; the value is never kept
  // What the applied entry currently authenticates with, if it is not already our helper. Replacing a working
  // static key with a helper that cannot resolve takes inference down (yogaNovo, 2026-09-18) — the credential the
  // owner is relying on is only visible here, before the write.
  const appliedDoc = install.installed ? await appliedEntry(io, env.os, env.home) : null;
  const live = appliedDoc && appliedDoc !== "invalid" ? appliedDoc.doc : null;
  const liveKind = cfgGet(live, ["inference", "credential", "kind"], "inferenceCredentialKind");
  const liveHelper = cfgGet(live, ["inference", "credential", "command"], "inferenceCredentialHelper");
  const liveCredential = live === null ? null
    : liveKind === "static" || live.inferenceGatewayApiKey !== undefined ? "a static key entered in the app"
    : typeof liveHelper === "string" && liveHelper !== helper ? `a credential helper (${liveHelper})`
    : null;
  return {
    install, versionOld: install.version !== null && !versionAtLeast(install.version, MIN_DESKTOP_VERSION),
    takeover: managedTakeover(sources), managedKeys: sources.reduce((n, s) => n + s.keys.length, 0),
    running: install.installed ? await desktopRunning(io, env.os) : false,
    ours, adopted, helper, helperBody, helperCurrent: (await io.readFile(helper)) === helperBody, wanted, docCurrent,
    haveSecret, liveCredential,
  };
}

function blockedReason(f: Facts, o: Opts): string | null {
  if (!f.install.installed) return `Claude Desktop not installed — https://claude.com/download (macOS .dmg; Windows .msix — the .exe installer has no Cowork)`;
  if (f.versionOld) return `Claude Desktop ${f.install.version} < ${MIN_DESKTOP_VERSION} — update it, then re-run`;
  if (f.takeover) return `managed configuration owns Claude Desktop (${f.takeover}) — the local config library is ignored. Ask IT for the gateway profile, or check Developer → Configure Third-Party Inference… (read-only there): provider gateway, base URL ${o.baseUrl}, credential via bs secrets check ${SECRET}`;
  if (f.ours === "invalid") return "a boot-slapper config-library entry or _meta.json is not valid JSON — fix or delete it by hand, then re-run";
  // The helper can only print what the store holds. With the key absent the write swaps a *working* credential for
  // one that resolves to nothing and inference stops at the next launch — observed on yogaNovo 2026-09-18, where the
  // owner had to restore the static key by hand. Only a block is safe here: apply steps run unattended under
  // `--auto`, so a warning would be read by nobody and the box would go down anyway. An empty store on a box with no
  // credential yet is *not* blocked — there is nothing to lose, the entry is written, and `verify` says the key is
  // missing — so this cannot stall a fresh onboard.
  if (!f.haveSecret && f.liveCredential) {
    return `${SECRET} is not in the secret store, and Claude Desktop is currently using ${f.liveCredential} — writing the credential helper now would leave it with nothing to read and stop inference at the next launch. Run bs secrets set ${SECRET} first (bs secrets check ${SECRET} confirms it), then re-run. Leaving it as-is also works: inference keeps running on the credential it has.`;
  }
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
      if (!f.docCurrent) details.push(`${D.stale} — will rewrite the inference keys`);
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
          // Re-checked here, not just in detect: the plan screen sits between the two, and the store is exactly the
          // kind of state that changes in between (the owner may run `bs secrets set` in another terminal — or, on a
          // box that reached this step from a stale plan, may have removed it).
          if (!f.haveSecret && f.liveCredential) throw new Error(`${SECRET} is not in the secret store and Claude Desktop is using ${f.liveCredential} — run bs secrets set ${SECRET} first; writing the helper now would stop inference`);
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
