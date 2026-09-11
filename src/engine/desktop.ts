import { randomUUID } from "node:crypto";
import { pj, type Os } from "./env.ts";
import type { Io } from "./io.ts";

/** Claude Desktop on 3P — where it keeps its per-user configuration and what boot-slapper owns there. Facts from docs/spikes/2026-09-10-s1-*.md and s2-*.md. */
export const ORG_SENTINEL = "00000000-0000-4000-8000-000000000001";
export const MIN_DESKTOP_VERSION = "1.19367.0";     // managed http/sse/stdio MCP entries, static headers, helpers; registry hives no longer merged
export const ENTRY_NAME = "boot-slapper";
/** Shared "Desktop is running" refusal for artifacts that must not touch the config library while it might be read (Task 4 reuses this for desktop-mcp). */
export const runningError = (artifactId: string) => `Claude Desktop is running — quit it (⌘Q / File → Exit) and re-run bs onboard --only ${artifactId}`;
export const MSIX_FAMILY = "AnthropicPBC.Claude_fnn82j28hfe8t";
/** A managed source that sets only these keeps the local config library in force (docs: mdm, "Update keys and managed precedence"). */
export const APP_BEHAVIOR_KEYS: ReadonlySet<string> = new Set(["disableAutoUpdates", "autoUpdaterEnforcementHours", "updateViaUpdatesHost", "relaunchEnforcementHours", "configRecheckIntervalMinutes", "egressProxyUrl", "egressProxyPacUrl"]);
const ENTRY_ID = /^[a-f0-9-]{36}$/;
const MANAGED_PLIST = "com.anthropic.claudefordesktop.plist";

const localAppData = (io: Io, home: string) => io.env.LOCALAPPDATA ?? pj("win32", home, "AppData", "Local");

export function desktopDataDir(io: Io, os: Os, home: string): string {
  if (os === "darwin") return pj(os, home, "Library", "Application Support", "Claude-3p");
  if (os === "win32") return pj(os, localAppData(io, home), "Claude-3p");
  return pj(os, home, ".config", "Claude-3p");
}
export const configLibraryDir = (io: Io, os: Os, home: string) => pj(os, desktopDataDir(io, os, home), "configLibrary");
export const bsDir = (os: Os, home: string) => pj(os, home, ".config", "boot-slapper");
export const sidecarPath = (os: Os, home: string) => pj(os, bsDir(os, home), "desktop.json");

export interface DesktopInstall { installed: boolean; path: string; version: string | null }

export async function desktopInstall(io: Io, os: Os, home: string): Promise<DesktopInstall> {
  if (os === "darwin") {
    const app = "/Applications/Claude.app";
    if (!(await io.exists(app))) return { installed: false, path: app, version: null };
    const plist = (await io.readFile(pj(os, app, "Contents", "Info.plist"))) ?? "";
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
    return { installed: true, path: app, version: m ? m[1].trim() : null };
  }
  if (os === "win32") {
    const pkg = pj(os, localAppData(io, home), "Packages", MSIX_FAMILY);
    if (await io.exists(pkg)) {
      const r = await io.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name AnthropicPBC.Claude | Select-Object -First 1).Version"], { timeout: 20_000 });
      const v = r.code === 0 ? r.stdout.trim() : "";
      return { installed: true, path: pkg, version: /^\d+(\.\d+)+$/.test(v) ? v : null };
    }
    const legacy = pj(os, localAppData(io, home), "AnthropicClaude", "claude.exe");   // pre-MSIX .exe installer (no Cowork)
    return { installed: await io.exists(legacy), path: legacy, version: null };
  }
  const p = pj(os, home, ".local", "share", "claude-desktop");
  return { installed: await io.exists(p), path: p, version: null };
}

export function versionAtLeast(v: string | null, min: string): boolean {
  if (!v) return false;
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return true;
}

export interface ManagedSource { source: string; keys: string[]; readable: boolean }

const plistKeys = (xml: string) => [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const regKeys = (out: string) => out.split(/\r?\n/).map((l) => /^\s{2,}(\S+)\s+REG_[A-Z_]+(?:\s|$)/.exec(l)?.[1]).filter((k): k is string => !!k && k !== "(Default)");
const REG_ABSENT = /unable to find the specified registry key/i;

/**
 * Every managed source the app would read, with the keys it sets. darwin: per-user plist first (it wins).
 * win32: HKLM only when it holds any value, else HKCU. A source that exists but could not be read (plutil
 * failure, a reg-query failure other than "key not found", or invalid JSON) is still reported, with
 * `readable: false` and no keys — callers must not treat that as "this source sets nothing" (see managedTakeover).
 */
export async function managedSources(io: Io, os: Os): Promise<ManagedSource[]> {
  const out: ManagedSource[] = [];
  if (os === "darwin") {
    const user = io.env.USER ?? "";
    const paths = [user ? `/Library/Managed Preferences/${user}/${MANAGED_PLIST}` : null, `/Library/Managed Preferences/${MANAGED_PLIST}`].filter((p): p is string => !!p);
    for (const p of paths) {
      if (!(await io.exists(p))) continue;
      const r = await io.exec("plutil", ["-convert", "xml1", "-o", "-", p], { timeout: 10_000 });   // managed plists are binary; plutil is read-only with -o -
      out.push(r.code === 0 ? { source: p, keys: plistKeys(r.stdout), readable: true } : { source: p, keys: [], readable: false });
    }
  } else if (os === "win32") {
    for (const hive of ["HKLM", "HKCU"]) {
      const key = `${hive}\\SOFTWARE\\Policies\\Claude`;
      const r = await io.exec("reg", ["query", key], { timeout: 10_000 });
      if (r.code === 0) {
        const keys = regKeys(r.stdout);
        if (keys.length) { out.push({ source: key, keys, readable: true }); break; }     // v1.19367.0+: any HKLM value makes the app ignore HKCU entirely
        continue;
      }
      if (REG_ABSENT.test(r.stderr)) continue;     // hive genuinely absent — try the next one
      out.push({ source: key, keys: [], readable: false });     // exists but unreadable — fail closed, do not fall through to HKCU
      break;
    }
  } else {
    const p = "/etc/claude-desktop/managed-settings.json";
    const s = await io.readFile(p);
    if (s !== null) {
      try { out.push({ source: p, keys: Object.keys(JSON.parse(s) as Record<string, unknown>), readable: true }); }
      catch { out.push({ source: p, keys: [], readable: false }); }
    }
  }
  return out;
}

/** `null` only when every source was readable and set nothing but app-behaviour keys. An unreadable source fails closed: we cannot rule out a takeover, so we report one. */
export function managedTakeover(sources: ManagedSource[]): string | null {
  for (const s of sources) {
    if (!s.readable) return `could not read ${s.source}`;
    const owning = s.keys.filter((k) => !APP_BEHAVIOR_KEYS.has(k));
    if (owning.length) return `${s.source} sets ${owning.join(", ")}`;
  }
  return null;
}

export async function desktopRunning(io: Io, os: Os): Promise<boolean> {
  if (os === "darwin") return (await io.exec("pgrep", ["-f", "Claude.app/Contents/MacOS/Claude"], { timeout: 10_000 })).code === 0;
  if (os === "win32") { const r = await io.exec("tasklist", ["/FI", "IMAGENAME eq Claude.exe", "/NH"], { timeout: 10_000 }); return r.code === 0 && /^Claude\.exe\b/im.test(r.stdout); }
  return (await io.exec("pgrep", ["-f", "claude-desktop"], { timeout: 10_000 })).code === 0;
}

export interface LibraryMeta { appliedId: string; entries: Array<{ id: string; name: string }> }
const metaPath = (io: Io, os: Os, home: string) => pj(os, configLibraryDir(io, os, home), "_meta.json");
const entryPath = (io: Io, os: Os, home: string, id: string) => pj(os, configLibraryDir(io, os, home), `${id}.json`);

export async function readJson(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { const v = JSON.parse(s) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid"; } catch { return "invalid"; }
}

export async function readLibraryMeta(io: Io, os: Os, home: string): Promise<LibraryMeta | null | "invalid"> {
  const j = await readJson(io, metaPath(io, os, home));
  if (j === null || j === "invalid") return j;
  const entries = Array.isArray(j.entries) ? (j.entries as Array<{ id?: unknown; name?: unknown }>) : null;
  if (typeof j.appliedId !== "string" || !entries || !entries.every((e) => typeof e?.id === "string" && typeof e?.name === "string")) return "invalid";
  return { appliedId: j.appliedId, entries: entries.map((e) => ({ id: String(e.id), name: String(e.name) })) };
}

export async function readLibraryEntry(io: Io, os: Os, home: string, id: string): Promise<Record<string, unknown> | null | "invalid"> {
  if (!ENTRY_ID.test(id)) return "invalid";
  return readJson(io, entryPath(io, os, home, id));
}

export interface Sidecar { entryId?: string; servers?: string[]; skills?: Record<string, string> }

export async function readSidecar(io: Io, os: Os, home: string): Promise<Sidecar> {
  const j = await readJson(io, sidecarPath(os, home));
  return j && j !== "invalid" ? (j as Sidecar) : {};
}
export async function writeSidecar(io: Io, os: Os, home: string, patch: Partial<Sidecar>): Promise<Sidecar> {
  const next = { ...(await readSidecar(io, os, home)), ...patch };
  await io.mkdirp(bsDir(os, home), { mode: 0o700 });
  await io.writeFile(sidecarPath(os, home), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}

/** Read one setting from a library document in either accepted shape: nested v2 (`$schemaVersion: 2`) or flat v1 (documented key names). */
export function cfgGet(doc: Record<string, unknown> | null, nested: string[], flat: string): unknown {
  if (!doc) return undefined;
  let cur: unknown = doc;
  for (const k of nested) { if (typeof cur !== "object" || cur === null) { cur = undefined; break; } cur = (cur as Record<string, unknown>)[k]; }
  return cur !== undefined ? cur : doc[flat];
}

export interface OurEntry { id: string; doc: Record<string, unknown>; applied: boolean }

/** The boot-slapper entry: the sidecar's id when the meta still lists it, else the entry named boot-slapper. */
export async function ourEntry(io: Io, os: Os, home: string): Promise<OurEntry | null | "invalid"> {
  const meta = await readLibraryMeta(io, os, home);
  if (meta === null || meta === "invalid") return meta;
  const side = await readSidecar(io, os, home);
  const hit = meta.entries.find((e) => e.id === side.entryId) ?? meta.entries.find((e) => e.name === ENTRY_NAME);
  if (!hit) return null;
  const doc = await readLibraryEntry(io, os, home, hit.id);
  if (doc === "invalid") return "invalid";
  return { id: hit.id, doc: doc ?? {}, applied: meta.appliedId === hit.id };
}

export const newEntryId = () => randomUUID().toLowerCase();

export async function writeLibraryEntry(io: Io, os: Os, home: string, id: string, doc: Record<string, unknown>): Promise<void> {
  await io.mkdirp(configLibraryDir(io, os, home), { mode: 0o700 });
  await io.writeFile(entryPath(io, os, home, id), JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
}

export async function upsertMeta(io: Io, os: Os, home: string, entry: { id: string; name: string }, apply: boolean): Promise<void> {
  const cur = await readLibraryMeta(io, os, home);
  if (cur === "invalid") throw new Error("configLibrary/_meta.json is not valid — fix it by hand (or delete the configLibrary directory to reset Desktop's local 3P configuration), then re-run");
  const meta: LibraryMeta = cur ?? { appliedId: "", entries: [] };
  if (!meta.entries.some((e) => e.id === entry.id)) meta.entries.push(entry);
  if (apply || !meta.appliedId) meta.appliedId = entry.id;
  await io.mkdirp(configLibraryDir(io, os, home), { mode: 0o700 });
  await io.writeFile(metaPath(io, os, home), JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
}

/** `ant-did` holds the 3P account uuid base64-encoded (docs: data-storage, "Identity"). */
export function decodeAntDid(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  const v = Buffer.from(s, "base64").toString("utf8").trim();
  return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
}
