import path from "node:path";
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj, type Os } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import { defaultAccount } from "../engine/secrets/store.ts";
import { cloneUrl } from "./claude-config.ts";
import { nodeVersion } from "./prereqs.ts";

const ID = "mct";
const step = (s: string, title: string, extra: Partial<Step> = {}): Step => ({ id: `${ID}.${s}`, title, ...extra });
interface Opts { sshUrl: string; httpsUrl: string; syncUrl: string; deviceIds?: Record<string, string> }

/** Mirrors HOOK_CHECKOUT_PROBES in me-count-token/src/hook-wrapper.ts — a fleet contract; the first entry is where a fresh clone lands. */
export const CHECKOUT_PROBES = ["projects/me-count-token", "Claude/me-count-token"] as const;
export const D = { clone: "no me-count-token checkout", build: "dist/ not built", activate: "mct not activated" } as const;

const nodeOk = (v: { major: number; minor: number } | null) => !!v && (v.major > 22 || (v.major === 22 && v.minor >= 5));
const tail = (s: string) => s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");

/** npm on Windows is npm.cmd, which Node refuses to spawn without a shell — run its JS entry through node instead. */
export async function npmArgv(io: Io, os: Os | string): Promise<[string, string[]] | null> {
  const p = await io.which("npm");
  if (!p) return null;
  if (os !== "win32") return ["npm", []];
  return ["node", [path.win32.join(path.win32.dirname(p), "node_modules", "npm", "bin", "npm-cli.js")]];
}

interface Facts { dir: string | null; cli: string; built: boolean; configPath: string; activated: boolean; npm: [string, string[]] | null; node: Awaited<ReturnType<typeof nodeVersion>> }

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx;
  let dir: string | null = null;
  for (const p of CHECKOUT_PROBES) { const d = pj(env.os, env.home, ...p.split("/")); if (await io.isDir(d)) { dir = d; break; } }
  const root = dir ?? pj(env.os, env.home, ...CHECKOUT_PROBES[0].split("/"));
  const configPath = pj(env.os, env.home, ".mct", "config.json");
  const cfg = await io.readFile(configPath);
  return {
    dir, cli: pj(env.os, root, "dist", "cli.js"),
    built: dir !== null && (await io.exists(pj(env.os, dir, "dist", "hooks", "session-start.js"))),
    configPath, activated: cfg !== null && cfg.trim().length > 0,          // bash: [[ -s config.json ]]
    npm: await npmArgv(io, env.os),
    node: (await io.which("node")) ? await nodeVersion(io) : null,
  };
}

export const mct: Artifact = {
  id: ID, surfaces: ["code"], portability: "translatable", requires: ["prereqs", "secrets"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.npm) return { kind: "blocked", reason: "npm not on PATH — the canonical hooks stay silent no-ops until an mct checkout is built" };
    const details: string[] = [];
    if (!f.dir) details.push(`${D.clone} — will clone to ~/${CHECKOUT_PROBES[0]}`);
    if (!f.built) details.push(`${D.build} — will npm install && npm run build`);
    if (!f.activated) details.push(`${D.activate} — will seed ~/.mct/config.json from the store and run mct onboard`);
    if (!details.length) return { kind: "present" };
    return f.dir ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = []; const o = ctx.opts as unknown as Opts;
    if (d.some((x) => x.startsWith(D.clone))) steps.push(step("clone", "clone me-count-token to ~/projects/me-count-token"));
    if (d.some((x) => x.startsWith(D.build))) steps.push(step("build", "npm install && npm run build in the mct checkout"));
    if (d.some((x) => x.startsWith(D.activate))) {
      const slug = o.deviceIds?.[ctx.env.label];
      steps.push(step("activate",
        slug ? `activate mct as '${slug}' (token from the store) and run mct onboard` : "activate mct: enter the MeCP device slug, token from the store, then mct onboard",
        { interactive: !slug, secret: { service: "mct-sync-token", account: defaultAccount(ctx.io) } }));
    }
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.clone`: {
          const dir = pj(env.os, env.home, ...CHECKOUT_PROBES[0].split("/"));
          await io.mkdirp(pj(env.os, env.home, "projects"));
          const r = await io.exec("git", ["clone", "--quiet", await cloneUrl(io, o.sshUrl, o.httpsUrl), dir], { env: { GIT_TERMINAL_PROMPT: "0" } });
          if (r.code !== 0) throw new Error(`git clone failed: ${tail(r.stderr)}`);
          break;
        }
        case `${ID}.build`: {
          const f = await facts(ctx);
          if (!f.dir || !f.npm) throw new Error("mct checkout or npm missing — the clone step must run first");
          const [npm, pre] = f.npm;
          const inst = await io.exec(npm, [...pre, "--prefix", f.dir, "install", "--no-audit", "--no-fund", "--silent"], { timeout: 600_000 });
          if (inst.code !== 0) throw new Error(`npm install failed in ${f.dir} (exit ${inst.code}): ${tail(inst.stderr)}`);
          const build = await io.exec(npm, [...pre, "--prefix", f.dir, "run", "--silent", "build"], { timeout: 600_000 });
          if (build.code !== 0) throw new Error(`npm run build failed in ${f.dir} (exit ${build.code}): ${tail(build.stderr)}`);
          break;
        }
        case `${ID}.activate`: {
          const f = await facts(ctx);
          if (!f.built) throw new Error("mct is not built — the build step must run first");
          // Validate any existing config up front: an invalid file must fail the step, never be silently skipped
          // behind a softer warn-and-continue path (node too old, no device id, no token) or clobbered by a fresh write.
          let existing: Record<string, unknown> = {};
          const raw = await io.readFile(f.configPath);
          if (raw !== null && raw.trim()) { try { existing = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`${f.configPath} is not valid JSON — fix it by hand, then re-run`); } }
          if (!nodeOk(f.node)) { ctx.emit({ type: "note", level: "warn", message: `mct: node ${f.node?.raw ?? "(missing)"} < 22.5 — hooks spool sidecars, but onboard needs node:sqlite; upgrade node and re-run` }); break; }
          const deviceId = o.deviceIds?.[env.label] ?? (ctx.interactive ? (await ctx.prompt.text("mct device id (MeCP device slug; blank to skip)", "")).trim() : "");
          if (!deviceId) { ctx.emit({ type: "note", level: "warn", message: "mct: no device id — activate later with bs onboard --only mct (interactive) or add deviceIds[<label>] to the profile" }); break; }
          if (!s.secret) throw new Error(`step ${s.id} carries no SecretRef`);
          const token = await ctx.secrets.get(s.secret);
          if (token === null) { ctx.emit({ type: "note", level: "warn", message: `mct: no sync token — bs secrets set mct-sync-token (mint it with \`mct devices add ${deviceId}\` on an admin box), then re-run` }); break; }
          // The token goes into mct's own store (mode 600) — never argv. A bare `onboard` is mct's repair pass: keeps every value, verifies token↔device, installs hooks/OTEL, scans, syncs, doctors.
          await io.mkdirp(pj(env.os, env.home, ".mct"), { mode: 0o700 });
          await io.writeFile(f.configPath, JSON.stringify({ ...existing, deviceId, syncUrl: o.syncUrl, syncToken: token }, null, 2) + "\n", { mode: 0o600 });
          const r = await io.exec("node", [f.cli, "onboard"], { timeout: 300_000 });
          if (r.code !== 0) ctx.emit({ type: "note", level: "warn", message: `mct onboard reported problems — node "${f.cli}" doctor: ${tail(r.stderr)}` });
          else ctx.emit({ type: "note", level: "info", message: `mct: activated as ${deviceId} → ${o.syncUrl}` });
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    if (!f.dir) return [{ id: "status", status: "warn", message: "no me-count-token checkout — sessions on this device are not token-tracked" }];
    if (!f.built) return [{ id: "status", status: "error", message: `mct checkout present but dist/ not built — hooks fire and silently exit: npm --prefix "${f.dir}" install && npm --prefix "${f.dir}" run build` }];
    if (!f.activated) return [{ id: "status", status: "warn", message: "mct built but not activated — bs secrets set mct-sync-token, then bs onboard --only mct" }];
    if (!nodeOk(f.node)) return [{ id: "status", status: "warn", message: `mct activated but node ${f.node?.raw ?? "(missing)"} < 22.5 — hooks spool, but scan/sync/doctor can't run (node:sqlite)` }];
    const r = await ctx.io.exec("node", [f.cli, "doctor"], { timeout: 60_000 });
    return [r.code === 0 ? { id: "status", status: "ok", message: "mct doctor passes" } : { id: "status", status: "warn", message: `mct doctor reports problems — node "${f.cli}" doctor` }];
  },

  async capture(): Promise<Bundle> {
    return { files: [], instructions: ["mct is rebuilt on the target (clone + npm run build). Activation needs a per-device sync token: `mct devices add <mecp-device-slug>` on an admin box, then `bs secrets set mct-sync-token` on the target"] };
  },
};
