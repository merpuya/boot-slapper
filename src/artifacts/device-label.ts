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
 * ("destination path already exists"). Within the same run the pin equals `ctx.env.label`, the label project-memory writes the device config under.
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

/** A hostname that looks like the product of reverse DNS / DHCP rather than a name the owner chose: dotted (an FQDN from a PTR) or carrying an IPv4 quad. */
export const looksLikeReverseDns = (h: string): boolean => h.includes(".") || /\d{1,3}[-.]\d{1,3}[-.]\d{1,3}[-.]\d{1,3}/.test(h) || /^ip-\d/i.test(h);

type Wanted = { label: string; source: string } | { refused: string };

async function hostNameSet(ctx: Ctx): Promise<boolean> {
  const r = await ctx.io.exec("scutil", ["--get", "HostName"]);
  return r.code === 0 && r.stdout.trim() !== "";
}

/**
 * Which label to pin. An explicit profile label is honoured only when it equals `ctx.env.label` (otherwise refused: two labels). Otherwise the pin is `ctx.env.label` — the label this run's other artifacts
 * (project-memory's devices/<label>.json, mct deviceIds) already use, and what claude-memory-sync `lib/device-label.sh` resolves
 * (uname -n) — so there is one label, never two. On macOS with no scutil HostName, uname -n follows reverse DNS, so if it looks
 * reverse-DNS-derived refuse rather than pin a label that will flip. Other platforms keep the hostname (a file, not a PTR).
 */
async function wantedLabel(ctx: Ctx): Promise<Wanted> {
  const explicit = (ctx.opts as Opts).label;
  const label = ctx.env.label;
  if (explicit) {
    // An explicit label that differs from this run's label would give the box two labels (project-memory / mct / claude-memory-sync
    // all key on ctx.env.label), orphaning the device config. Same remedies as the unstable-hostname refusal.
    if (explicit !== label) {
      return { refused: `profile label "${explicit}" differs from this box's label "${label}" (what project-memory, mct and claude-memory-sync use), so pinning it would give the device two labels — run sudo scutil --set HostName ${explicit}, or add env.DEVICE_LABEL to ~/.claude/settings.local.json by hand, then re-run` };
    }
    return { label: explicit, source: "profile" };
  }
  if (ctx.env.os !== "darwin") return { label, source: "hostname" };
  if (await hostNameSet(ctx)) return { label, source: "hostname (scutil HostName set)" };
  if (looksLikeReverseDns(label)) {
    return { refused: `hostname "${label}" looks reverse-DNS-derived and macOS has no scutil HostName, so the label would change with the network — run sudo scutil --set HostName <name>, or add env.DEVICE_LABEL to ~/.claude/settings.local.json by hand, then re-run` };
  }
  return { label, source: "hostname" };
}

export const deviceLabel: Artifact = {
  id: ID, surfaces: ["code"], portability: "device-bound", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (f.pin) return { kind: "present" };
    if (f.local === "invalid") return { kind: "blocked", reason: `${f.localPath} is not valid JSON — fix it by hand, then re-run` };
    const w = await wantedLabel(ctx);
    if ("refused" in w) return { kind: "blocked", reason: w.refused };
    return { kind: "absent", details: [`no DEVICE_LABEL pin — will pin "${w.label}" (${w.source}) in ~/.claude/settings.local.json`] };
  },

  plan(ctx, state): Step[] {
    if (state.kind !== "absent") return [];
    // state.details carries the resolved label; recompute is async, so the title reads it back from there.
    const m = /will pin "([^"]*)"/.exec(state.details?.[0] ?? "");
    return [{ id: `${ID}.pin`, title: `pin env.DEVICE_LABEL="${m ? m[1] : (ctx.opts as Opts).label || ctx.env.label}" in ~/.claude/settings.local.json` }];
  },

  async apply(ctx, steps) {
    for (const s of steps) {
      if (s.id !== `${ID}.pin`) throw new Error(`unknown step ${s.id}`);
      // Re-check at apply time: a pin that appeared since detect() must win, and an unparseable file must fail, never be clobbered.
      const f = await facts(ctx);
      if (f.pin) { ctx.emit({ type: "note", level: "info", message: `device-label: already pinned (${f.pin.value} from ${f.pin.source}) — left alone` }); continue; }
      if (f.local === "invalid") throw new Error(`${f.localPath} is not valid JSON — fix it by hand, then re-run`);
      const w = await wantedLabel(ctx);
      if ("refused" in w) throw new Error(`unstable hostname — ${w.refused}`);
      const current = f.local ?? {};
      const env = typeof current.env === "object" && current.env !== null && !Array.isArray(current.env) ? (current.env as Record<string, unknown>) : {};
      await ctx.io.writeFile(f.localPath, stableJson({ ...current, env: { ...env, DEVICE_LABEL: w.label } }));
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    const claude = pj(ctx.env.os, ctx.env.claudeDir, FILES[0]);
    if (f.pin) {
      // Drift is noted in the message, never repaired (re-pinning would orphan the device config the old label named). Status stays
      // ok: bash `bootstrap.sh --doctor` prints ok for any pin, and the parity gate compares statuses.
      if (ctx.env.os === "darwin" && ctx.io.hostname !== f.pin.value && !(await hostNameSet(ctx))) {
        return [{ id: "label", status: "ok", message: `device label: ${f.pin.value} (from ${f.pin.source}) — pin kept; hostname is now "${ctx.io.hostname}" (no scutil HostName, so it follows the network)` }];
      }
      return [{ id: "label", status: "ok", message: `device label: ${f.pin.value} (from ${f.pin.source})` }];
    }
    if (f.local === "invalid") return [{ id: "label", status: "error", message: `${f.localPath} is not valid JSON — fix it by hand (device-label cannot check or write the pin)` }];
    const host = ctx.io.hostname;
    // Same verdicts as bootstrap.sh --doctor: only macOS with no scutil HostName has an unstable hostname.
    if (ctx.env.os !== "darwin") return [{ id: "label", status: "ok", message: `device label: ${host} (from hostname)` }];
    if (await hostNameSet(ctx)) return [{ id: "label", status: "ok", message: `device label: ${host} (from hostname, scutil HostName set)` }];
    if (looksLikeReverseDns(host)) {
      return [{ id: "label", status: "warn", message: `device label: ${host} (from hostname) — unpinned and reverse-DNS-looking; it will change with the network. Set scutil HostName or pin env.DEVICE_LABEL in ${claude}` }];
    }
    return [{ id: "label", status: "warn", message: `device label: ${host} (from hostname) — unpinned; macOS can change it with the network. Pin env.DEVICE_LABEL in ${claude}` }];
  },
};
