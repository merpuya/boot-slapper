import { isDeepStrictEqual } from "node:util";
import type { Os } from "./env.ts";

/** Keys that point INTO the dotclaude repo — reconciled when drifted (apply-settings-template.sh MANAGED). Keep small. */
export const MANAGED_KEYS: ReadonlySet<string> = new Set(["statusLine"]);

export interface SeedResult { next: Record<string, unknown>; added: string[]; stale: string[] }

export function seedSettings(settings: Record<string, unknown> | null, template: Record<string, unknown>): SeedResult {
  if ("hooks" in template) throw new Error("refusing: template contains a hooks key — hooks are owned by canonical-hooks.json");
  if (settings === null) return { next: structuredClone(template), added: Object.keys(template), stale: [] };
  const added = Object.keys(template).filter((k) => !(k in settings));
  const stale = [...MANAGED_KEYS].filter((k) => k in template && k in settings && !isDeepStrictEqual(settings[k], template[k]));
  const next = structuredClone(settings);
  for (const k of [...added, ...stale]) next[k] = structuredClone(template[k]);
  return { next, added, stale };
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
