import { isDeepStrictEqual } from "node:util";
import type { Os } from "./env.ts";

/** Keys that point INTO the dotclaude repo — reconciled when drifted (apply-settings-template.sh MANAGED). Keep small. */
export const MANAGED_KEYS: ReadonlySet<string> = new Set(["statusLine"]);

/** A settings / remember-config applier refusing to touch a file it cannot merge into safely (the bash appliers' `refusing: ...` exit). */
export class SettingsRefusal extends Error {
  constructor(message: string) { super(message); this.name = "SettingsRefusal"; }
}

export interface SeedResult {
  next: Record<string, unknown>;
  /** Top-level template keys missing from settings.json (seed-only: filled whole). */
  added: string[];
  /** MANAGED keys whose value drifted (reconciled). */
  stale: string[];
  /** Template `env` sub-keys missing from an EXISTING settings.json env block (add-only; an absent env block is `added` whole instead). */
  envAdded: string[];
  /** Template `permissions.allow` entries missing from an EXISTING settings.json permissions block (union; never removes). */
  allowAdded: unknown[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * apply-settings-template.sh, in one pure function (its `--check` twin reads the same result). Top-level template keys are seed-only
 * and MANAGED_KEYS are reconciled; on top of that two sub-key merges, both add-only, because `env` and `permissions` are seed-only
 * top-level keys and a new template sub-key would otherwise never reach a box that already has the block:
 *  - `env`: a template key absent from settings.json's env is added; a key present locally (any value) is never touched; a local-only key is never removed.
 *  - `permissions.allow`: template entries missing locally are appended after the local ones; nothing is ever removed.
 * Throws SettingsRefusal on a non-object env / permissions or a non-list allow (fix by hand), in check and apply alike.
 */
export function seedSettings(settings: Record<string, unknown> | null, template: Record<string, unknown>): SeedResult {
  if ("hooks" in template) throw new Error("refusing: template contains a hooks key — hooks are owned by canonical-hooks.json");
  if (settings === null) return { next: structuredClone(template), added: Object.keys(template), stale: [], envAdded: [], allowAdded: [] };
  const added = Object.keys(template).filter((k) => !(k in settings));
  const stale = [...MANAGED_KEYS].filter((k) => k in template && k in settings && !isDeepStrictEqual(settings[k], template[k]));

  const tmplPerms = isObject(template.permissions) ? template.permissions : {};
  const tmplAllow = Array.isArray(tmplPerms.allow) ? (tmplPerms.allow as unknown[]) : [];
  let allowAdded: unknown[] = [];
  if (tmplAllow.length && "permissions" in settings) {
    const perms = settings.permissions;
    if (!isObject(perms) || ("allow" in perms && !Array.isArray(perms.allow))) throw new SettingsRefusal("refusing: settings.json permissions / permissions.allow is not an object / list — fix by hand");
    const have = (perms.allow ?? []) as unknown[];
    allowAdded = tmplAllow.filter((e) => !have.some((h) => isDeepStrictEqual(h, e)));  // any entry type: the applier appends whatever the template lists
  }

  // The applier reads `template.get("env") or {}`: any falsy value (null, false, 0, "", []) is an empty env.
  const rawEnv = template.env;
  const envEmpty = !rawEnv || (Array.isArray(rawEnv) && rawEnv.length === 0);
  if (!envEmpty && !isObject(rawEnv)) throw new SettingsRefusal("refusing: template env is not an object");
  const tmplEnv = (envEmpty ? {} : rawEnv) as Record<string, unknown>;
  let envAdded: string[] = [];
  if (Object.keys(tmplEnv).length && "env" in settings) {
    if (!isObject(settings.env)) throw new SettingsRefusal("refusing: settings.json env is not an object — fix by hand");
    const env = settings.env;
    envAdded = Object.keys(tmplEnv).filter((k) => !(k in env));
  }

  const next = structuredClone(settings);
  for (const k of [...added, ...stale]) next[k] = structuredClone(template[k]);
  if (allowAdded.length) {
    const perms = next.permissions as Record<string, unknown>;
    perms.allow = [...((perms.allow ?? []) as unknown[]), ...allowAdded];
  }
  for (const k of envAdded) (next.env as Record<string, unknown>)[k] = structuredClone(tmplEnv[k]);
  return { next, added, stale, envAdded, allowAdded };
}

/** The one key apply-remember-config.sh manages in the claude-remember plugin's user-global config (~/.remember/config.json). */
export const REMEMBER_FEATURE = "plugin_promos";
export interface RememberResult { next: Record<string, unknown>; changed: boolean; existed: boolean }

/**
 * apply-remember-config.sh: merge features.plugin_promos = false, add-only. File absent -> just that key; key absent -> added with every
 * other key kept; key present, any value -> never overwritten (a local `true` is a choice). Throws SettingsRefusal on a non-object `features`.
 * `cfg` is the parsed file, or null when the file does not exist.
 */
export function seedRememberConfig(cfg: Record<string, unknown> | null): RememberResult {
  const existed = cfg !== null;
  const next = structuredClone(cfg ?? {});
  const features = "features" in next ? next.features : {};   // an explicit null is not an object either (the bash applier refuses it)
  if (!isObject(features)) throw new SettingsRefusal("refusing: ~/.remember/config.json features is not an object — fix by hand");
  if (REMEMBER_FEATURE in features) return { next, changed: false, existed };
  features[REMEMBER_FEATURE] = false;
  next.features = features;
  return { next, changed: true, existed };
}

export type HookEntry = Record<string, unknown> & { command?: string; platforms?: string[] };
export type HooksBlock = Record<string, Array<{ matcher?: string; hooks: HookEntry[] }>>;
export interface RenderOpts { platform: Os; nodeExe?: string; homeWin?: string }

// `node "$HOME/rel/path.mjs"` plus optional whitespace-separated literal args (apply-canonical-hooks.sh NODE_SHELL_FORM).
const NODE_SHELL_FORM = /^node\s+"\$HOME\/(?<rel>[^"]+\.mjs)"(?<rest>.*)$/;

function toExecForm(hook: HookEntry, nodeExe: string, homeWin: string): HookEntry {
  const m = NODE_SHELL_FORM.exec(String(hook.command ?? ""));
  if (!m?.groups) return hook;
  const script = homeWin.replace(/\\+$/, "") + "\\" + m.groups.rel.replace(/\//g, "\\");
  const rest = m.groups.rest.trim();
  return { ...hook, command: nodeExe, args: [script, ...(rest ? rest.split(/\s+/) : [])] };
}

export function renderHooks(canonical: HooksBlock, opts: RenderOpts): HooksBlock {
  const out: HooksBlock = {};
  for (const [event, groups] of Object.entries(canonical)) {
    const kept: HooksBlock[string] = [];
    for (const group of groups) {
      const hooks: HookEntry[] = [];
      for (const h of group.hooks) {
        if (h.platforms !== undefined && !h.platforms.includes(opts.platform)) continue;
        const { platforms: _p, ...rest } = h;
        hooks.push(opts.platform === "win32" && opts.nodeExe && opts.homeWin ? toExecForm(rest, opts.nodeExe, opts.homeWin) : rest);
      }
      if (hooks.length) kept.push({ ...group, hooks });
    }
    if (kept.length) out[event] = kept;
  }
  return out;
}

export function stableJson(v: unknown): string { return JSON.stringify(v, null, 2) + "\n"; }
export function deepEqual(a: unknown, b: unknown): boolean { return isDeepStrictEqual(a, b); }
