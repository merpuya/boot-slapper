import path from "node:path";
import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { defaultAccount } from "../engine/secrets/store.ts";
import { renderCmd, renderPs1 } from "./templates/claude-gw.ps1.ts";
import { renderZsh } from "./templates/claude-gw.zsh.ts";

export const MARKER = "# boot-slapper:claude-gw";
const ID = "gateway-launch";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { baseUrl: string; mcpBundle?: string }

interface Layout { wrapper: string; wrapperBody: string; rcFile: string; rcLine: string; cmdShim?: string; bundle: string }

async function layout(ctx: Ctx): Promise<Layout> {
  const { env, io } = ctx; const o = ctx.opts as unknown as Opts;
  const P = env.os === "win32" ? path.win32 : path.posix;
  const cfg = P.join(env.home, ".config", "boot-slapper");
  const bundle = o.mcpBundle ?? P.join(env.claudeDir, "mcp", "gateway.json");
  if (env.os === "win32") {
    const prof = await io.exec("powershell", ["-NoProfile", "-Command", "$PROFILE"]);
    const rcFile = prof.code === 0 && prof.stdout.trim() ? prof.stdout.trim() : P.join(env.home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    return {
      wrapper: P.join(cfg, "claude-gw.ps1"), wrapperBody: renderPs1({ baseUrl: o.baseUrl, mcpBundle: bundle, home: env.home }),
      cmdShim: P.join(env.home, ".local", "bin", "claude-gw.cmd"),
      rcFile, rcLine: `. "$env:USERPROFILE\\.config\\boot-slapper\\claude-gw.ps1"  ${MARKER}`, bundle,
    };
  }
  return {
    wrapper: P.join(cfg, "claude-gw.zsh"), wrapperBody: renderZsh({ baseUrl: o.baseUrl, mcpBundle: bundle, home: env.home }),
    rcFile: P.join(env.home, ".zshrc"),
    rcLine: `[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  ${MARKER}`, bundle,
  };
}

const hasMarker = (rc: string | null) => (rc ?? "").split(/\r?\n/).some((l) => l.includes(MARKER));
const legacyLine = (rc: string | null) => (rc ?? "").split(/\r?\n/).find((l) => /claude-gw\.zsh/.test(l) && !l.includes(MARKER));

export const gatewayLaunch: Artifact = {
  id: ID, surfaces: ["code"], portability: "translatable", requires: ["claude-config", "secrets"],

  async detect(ctx): Promise<State> {
    const L = await layout(ctx); const { io } = ctx;
    const current = await io.readFile(L.wrapper);
    const rc = await io.readFile(L.rcFile);
    const details: string[] = [];
    if (current === null) details.push("wrapper absent — will write");
    else if (current !== L.wrapperBody) details.push("wrapper differs from the generated version — will regenerate");
    if (L.cmdShim && (await io.readFile(L.cmdShim)) !== renderCmd()) details.push("cmd shim absent or stale — will write");
    if (!hasMarker(rc)) details.push(`no ${MARKER} line in ${L.rcFile} — will append`);
    if (!details.length) return { kind: "present" };
    return current === null ? { kind: "absent", details } : { kind: "drifted", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith("wrapper"))) steps.push(step("wrapper", "write the claude-gw wrapper"));
    if (d.some((x) => x.startsWith("cmd shim"))) steps.push(step("cmd-shim", "write ~/.local/bin/claude-gw.cmd"));
    if (d.some((x) => x.startsWith("no "))) steps.push(step("shell-rc", "append the claude-gw source line to the shell profile"));
    return steps;
  },

  async apply(ctx, steps) {
    const L = await layout(ctx); const { io } = ctx;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.wrapper`: await io.writeFile(L.wrapper, L.wrapperBody, { mode: 0o644 }); break;
        case `${ID}.cmd-shim`: if (L.cmdShim) await io.writeFile(L.cmdShim, renderCmd()); break;
        case `${ID}.shell-rc`: {
          const rc = (await io.readFile(L.rcFile)) ?? "";
          if (hasMarker(rc)) break;
          await io.writeFile(L.rcFile, (rc.length && !rc.endsWith("\n") ? rc + "\n" : rc) + L.rcLine + "\n");
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const L = await layout(ctx); const { io, env } = ctx; const out: Check[] = [];
    const wrapper = await io.readFile(L.wrapper);
    out.push(wrapper === L.wrapperBody ? { id: "wrapper", status: "ok", message: `wrapper current: ${L.wrapper}` } : { id: "wrapper", status: "error", message: `wrapper missing or stale: ${L.wrapper} — run bs onboard` });
    const rc = await io.readFile(L.rcFile);
    out.push(hasMarker(rc) ? { id: "shell-rc", status: "ok", message: `${L.rcFile} sources the wrapper` } : { id: "shell-rc", status: "error", message: `${L.rcFile} lacks the claude-gw line — run bs onboard` });
    const legacy = legacyLine(rc);
    if (legacy) out.push({ id: "legacy-wrapper", status: "warn", message: `legacy claude-gw definition also sourced (${legacy.trim()}) — remove it after gate 2 (dotfiles/zsh/claude-gw.zsh)` });
    const bundle = await io.readFile(L.bundle);
    let bundleOk = false;
    try { const j = bundle ? (JSON.parse(bundle) as { mcpServers?: Record<string, unknown> }) : null; bundleOk = !!j?.mcpServers?.mecp && !!j?.mcpServers?.openbrain; } catch { bundleOk = false; }
    out.push(bundleOk ? { id: "mcp-bundle", status: "ok", message: `${L.bundle} has mecp + openbrain` } : { id: "mcp-bundle", status: "error", message: `${L.bundle} missing or lacks mecp/openbrain — it is a tracked dotclaude file; check the claude-config artifact` });
    const ref = { service: "cornell-ai-gateway" as const, account: defaultAccount(io) };
    out.push((await ctx.secrets.get(ref)) !== null ? { id: "gateway-secret", status: "ok", message: "gateway token present" } : { id: "gateway-secret", status: "error", message: `gateway token missing — bs secrets set cornell-ai-gateway (${ctx.secrets.describe(ref)})` });
    if (env.os === "win32") {
      const bin = path.win32.join(env.home, ".local", "bin").toLowerCase();
      const onPath = (io.env.PATH ?? io.env.Path ?? "").split(";").some((p) => p.trim().toLowerCase() === bin);
      out.push(onPath ? { id: "path", status: "ok", message: "~/.local/bin is on PATH (claude-gw.cmd reachable from cmd/Git Bash)" } : { id: "path", status: "warn", message: "~/.local/bin not on PATH — claude-gw.cmd only reachable by full path; the PowerShell function works regardless" });
    }
    return out;
  },
};
