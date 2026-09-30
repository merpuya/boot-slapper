import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import { stableJson } from "../engine/settings.ts";

/**
 * Pins `env.DEVICE_LABEL` in `~/.claude/settings.local.json` on a box that has no pin anywhere in the chain
 * (DEVICE_LABEL env → settings.local.json → settings.json). The chain is the one `resolveLabel`, `bootstrap.sh --doctor`
 * and claude-memory-sync's `lib/device-label.sh` all walk. A hostname-derived label is only as stable as the hostname:
 * macOS with no scutil HostName takes `uname -n` from reverse DNS, so the label can change with the network and orphan
 * the memory device config (mac-studio, 2026-09-24: three labels in a day).
 *
 * Never rewrites an existing pin — not even a different one. Requires claude-config: on a fresh box ~/.claude does not exist
 * yet, and writing settings.local.json first would create the directory and make claude-config's `git clone` fail
 * ("destination path already exists"). Within the same run the pin equals the hostname the ctx already resolved.
 */
interface Opts { label?: string }
const ID = "device-label";
const FILES = ["settings.local.json", "settings.json"] as const;

interface Pin { value: string; source: string }
interface Facts { pin: Pin | null; localPath: string; local: Record<string, unknown> | null | "invalid" }

async function readObject(ctx: Ctx, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await ctx.io.readFile(p);
  if (s === null) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid";
  } catch { return "invalid"; }
}

const pinOf = (j: Record<string, unknown> | null | "invalid"): string | null => {
  if (j === null || j === "invalid") return null;
  const v = (j.env as Record<string, unknown> | undefined)?.DEVICE_LABEL;
  return typeof v === "string" && v ? v : null;
};

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx;
  const localPath = pj(env.os, env.claudeDir, FILES[0]);
  const local = await readObject(ctx, localPath);
  let pin: Pin | null = null;
  if (io.env.DEVICE_LABEL) pin = { value: io.env.DEVICE_LABEL, source: "DEVICE_LABEL env" };
  else for (const f of FILES) {
    const v = pinOf(f === FILES[0] ? local : await readObject(ctx, pj(env.os, env.claudeDir, f)));
    if (v) { pin = { value: v, source: f }; break; }
  }
  return { pin, localPath, local };
}

const wanted = (ctx: Ctx) => (ctx.opts as Opts).label || ctx.io.hostname;

export const deviceLabel: Artifact = {
  id: ID, surfaces: ["code"], portability: "device-bound", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (f.pin) return { kind: "present" };
    if (f.local === "invalid") return { kind: "blocked", reason: `${f.localPath} is not valid JSON — fix it by hand, then re-run` };
    return { kind: "absent", details: [`no DEVICE_LABEL pin — will pin "${wanted(ctx)}" in ~/.claude/settings.local.json`] };
  },

  plan(ctx, state): Step[] {
    return state.kind === "absent" ? [{ id: `${ID}.pin`, title: `pin env.DEVICE_LABEL="${wanted(ctx)}" in ~/.claude/settings.local.json` }] : [];
  },

  async apply(ctx, steps) {
    for (const s of steps) {
      if (s.id !== `${ID}.pin`) throw new Error(`unknown step ${s.id}`);
      // Re-check at apply time: a pin that appeared since detect() must win, and an unparseable file must fail, never be clobbered.
      const f = await facts(ctx);
      if (f.pin) { ctx.emit({ type: "note", level: "info", message: `device-label: already pinned (${f.pin.value} from ${f.pin.source}) — left alone` }); continue; }
      if (f.local === "invalid") throw new Error(`${f.localPath} is not valid JSON — fix it by hand, then re-run`);
      const current = f.local ?? {};
      const env = typeof current.env === "object" && current.env !== null && !Array.isArray(current.env) ? (current.env as Record<string, unknown>) : {};
      await ctx.io.writeFile(f.localPath, stableJson({ ...current, env: { ...env, DEVICE_LABEL: wanted(ctx) } }));
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    const claude = pj(ctx.env.os, ctx.env.claudeDir, FILES[0]);
    if (f.pin) return [{ id: "label", status: "ok", message: `device label: ${f.pin.value} (from ${f.pin.source})` }];
    if (f.local === "invalid") return [{ id: "label", status: "error", message: `${f.localPath} is not valid JSON — fix it by hand (device-label cannot check or write the pin)` }];
    const host = ctx.io.hostname;
    // Same verdicts as bootstrap.sh --doctor: only macOS with no scutil HostName has an unstable hostname.
    if (ctx.env.os !== "darwin") return [{ id: "label", status: "ok", message: `device label: ${host} (from hostname)` }];
    const r = await ctx.io.exec("scutil", ["--get", "HostName"]);
    if (r.code === 0) return [{ id: "label", status: "ok", message: `device label: ${host} (from hostname, scutil HostName set)` }];
    return [{ id: "label", status: "warn", message: `device label: ${host} (from hostname) — unpinned; macOS can change it with the network. Pin env.DEVICE_LABEL in ${claude}` }];
  },
};
