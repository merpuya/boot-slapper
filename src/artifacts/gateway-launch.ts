import path from "node:path";
import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { defaultAccount } from "../engine/secrets/store.ts";
import { renderCmd, renderPs1, renderRunnerPs1 } from "./templates/claude-gw.ps1.ts";
import { renderZsh } from "./templates/claude-gw.zsh.ts";

export const MARKER = "# boot-slapper:claude-gw";
const ID = "gateway-launch";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { baseUrl: string; mcpBundle?: string }

/** `rcFiles` is every shell profile that must source the wrapper — more than one on Windows. */
interface Layout { wrapper: string; wrapperBody: string; rcFiles: string[]; rcLine: string; cmdShim?: string; runner?: string; runnerBody?: string; bundle: string }

/**
 * Both PowerShell editions' `$PROFILE`, for whichever of them is installed.
 *
 * Windows PowerShell 5.1 and PowerShell 7 do **not** share a profile: 5.1 uses
 * `Documents\WindowsPowerShell\…`, 7 uses `Documents\PowerShell\…`. Probing only `powershell` (5.1) wrote
 * the source line into a file a pwsh user's shell never reads — and `verify` then reported ✓, so the
 * wrapper looked installed while `MECP_DEVICE_TOKEN` was never exported and `mecp` would 401. Observed on
 * yogaNovo 2026-09-18, where the owner's daily shell is pwsh 7.6.6.
 *
 * Ask each edition for its own `$PROFILE` rather than composing the path, so a redirected Documents
 * folder is honored — on this box Known Folder Move puts both under OneDrive, which no hard-coded
 * `%USERPROFILE%\Documents` would find. An edition that is not installed contributes nothing; the 5.1
 * default is the last-resort fallback so a box with neither probe working still gets one real path.
 */
async function psProfiles(ctx: Ctx, P: path.PlatformPath): Promise<string[]> {
  const { env, io } = ctx;
  const out: string[] = [];
  for (const exe of ["powershell", "pwsh"]) {
    const r = await io.exec(exe, ["-NoProfile", "-Command", "$PROFILE"], { timeout: 20_000 });
    const p = r.code === 0 ? r.stdout.trim() : "";
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length ? out : [P.join(env.home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")];
}

async function layout(ctx: Ctx): Promise<Layout> {
  const { env, io } = ctx; const o = ctx.opts as unknown as Opts;
  const P = env.os === "win32" ? path.win32 : path.posix;
  const cfg = P.join(env.home, ".config", "boot-slapper");
  const bundle = o.mcpBundle ?? P.join(env.claudeDir, "mcp", "gateway.json");
  if (env.os === "win32") {
    return {
      wrapper: P.join(cfg, "claude-gw.ps1"), wrapperBody: renderPs1({ baseUrl: o.baseUrl, mcpBundle: bundle, home: env.home }),
      cmdShim: P.join(env.home, ".local", "bin", "claude-gw.cmd"),
      runner: P.join(cfg, "claude-gw-run.ps1"), runnerBody: renderRunnerPs1(),
      rcFiles: await psProfiles(ctx, P), rcLine: `. "$env:USERPROFILE\\.config\\boot-slapper\\claude-gw.ps1"  ${MARKER}`, bundle,
    };
  }
  return {
    wrapper: P.join(cfg, "claude-gw.zsh"), wrapperBody: renderZsh({ baseUrl: o.baseUrl, mcpBundle: bundle, home: env.home }),
    rcFiles: [P.join(env.home, ".zshrc")],
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
    const details: string[] = [];
    if (current === null) details.push("wrapper absent — will write");
    else if (current !== L.wrapperBody) details.push("wrapper differs from the generated version — will regenerate");
    if (L.runner) {
      const curRunner = await io.readFile(L.runner);
      if (curRunner === null) details.push("wrapper absent — will write");
      else if (curRunner !== L.runnerBody) details.push("wrapper differs from the generated version — will regenerate");
    }
    if (L.cmdShim && (await io.readFile(L.cmdShim)) !== renderCmd()) details.push("cmd shim absent or stale — will write");
    // Every installed shell's profile, not just the first: a line in 5.1's profile does nothing for a pwsh user.
    for (const f of L.rcFiles) if (!hasMarker(await io.readFile(f))) details.push(`no ${MARKER} line in ${f} — will append`);
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
        case `${ID}.wrapper`:
          await io.writeFile(L.wrapper, L.wrapperBody, { mode: 0o644 });
          if (L.runner && L.runnerBody !== undefined) await io.writeFile(L.runner, L.runnerBody, { mode: 0o644 });
          break;
        case `${ID}.cmd-shim`: if (L.cmdShim) await io.writeFile(L.cmdShim, renderCmd()); break;
        case `${ID}.shell-rc`: {
          // One line per installed shell. Each file is re-checked for the marker, so this stays idempotent
          // and never appends to a profile that already sources the wrapper.
          for (const f of L.rcFiles) {
            const rc = (await io.readFile(f)) ?? "";
            if (hasMarker(rc)) continue;
            await io.writeFile(f, (rc.length && !rc.endsWith("\n") ? rc + "\n" : rc) + L.rcLine + "\n");
          }
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const L = await layout(ctx); const { io, env } = ctx; const out: Check[] = [];
    const wrapper = await io.readFile(L.wrapper);
    let wrapperOk = wrapper === L.wrapperBody;
    if (L.runner) wrapperOk = wrapperOk && (await io.readFile(L.runner)) === L.runnerBody;
    out.push(wrapperOk ? { id: "wrapper", status: "ok", message: `wrapper current: ${L.wrapper}` } : { id: "wrapper", status: "error", message: `wrapper missing or stale: ${L.wrapper} — run bs onboard` });
    // One check per profile, named by file. A single rolled-up check reported ✓ when only 5.1's profile
    // carried the line, hiding that the owner's pwsh shell sourced nothing.
    for (const f of L.rcFiles) {
      const rc = await io.readFile(f);
      // Only disambiguate when there really are several profiles, so the single-profile ids stay `shell-rc`
      // and `legacy-wrapper` (macOS, and any caller matching on those names).
      const suffix = L.rcFiles.length > 1 ? `.${path.win32.basename(path.win32.dirname(f))}` : "";
      out.push(hasMarker(rc) ? { id: `shell-rc${suffix}`, status: "ok", message: `${f} sources the wrapper` } : { id: `shell-rc${suffix}`, status: "error", message: `${f} lacks the claude-gw line — run bs onboard` });
      const legacy = legacyLine(rc);
      if (legacy) out.push({ id: `legacy-wrapper${suffix}`, status: "warn", message: `legacy claude-gw definition also sourced in ${f} (${legacy.trim()}) — remove it after gate 2 (dotfiles/zsh/claude-gw.zsh)` });
    }
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
