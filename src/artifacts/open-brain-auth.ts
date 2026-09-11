import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { desktopDataDir, desktopInstall } from "../engine/desktop.ts";
import { pj } from "../engine/env.ts";
import { defaultAccount } from "../engine/secrets/store.ts";

const ID = "open-brain-auth";
interface Opts { server: string }
export const D = { code: "Claude Code has no Open Brain grant", desktop: "Claude Desktop has no Open Brain grant" } as const;
const CODE_HINT = (s: string) => `Claude Code: /mcp → ${s} → Authenticate`;
const DESK_HINT = (s: string) => `Claude Desktop: Connectors → ${s} → Connect`;

/** Claude Code keeps MCP OAuth grants in its credentials store under `mcpOAuth`, keyed `<server>|<hash>`. The value is read in-process and discarded. */
async function codeGrant(ctx: Ctx, server: string): Promise<boolean> {
  const { io, env } = ctx; let raw: string | null = null;
  if (env.os === "darwin") { const r = await io.exec("security", ["find-generic-password", "-w", "-s", "Claude Code-credentials", "-a", defaultAccount(io)]); raw = r.code === 0 ? r.stdout : null; }
  else raw = await io.readFile(pj(env.os, env.claudeDir, ".credentials.json"));
  if (raw === null) return false;
  try { const j = JSON.parse(raw) as { mcpOAuth?: Record<string, unknown> }; return Object.keys(j.mcpOAuth ?? {}).some((k) => k === server || k.startsWith(`${server}|`)); } catch { return false; }
}
/** Desktop (3P) keeps its MCP OAuth state in its electron-store, key `custom3pMcpOAuth`, one safeStorage-encrypted blob per server name. */
async function desktopGrant(ctx: Ctx, server: string): Promise<boolean> {
  const raw = await ctx.io.readFile(pj(ctx.env.os, desktopDataDir(ctx.io, ctx.env.os, ctx.env.home), "config.json"));
  if (raw === null) return false;
  try { const j = JSON.parse(raw) as { custom3pMcpOAuth?: Record<string, unknown> }; return typeof j.custom3pMcpOAuth?.[server] === "string" || typeof j.custom3pMcpOAuth?.[server] === "object"; } catch { return false; }
}

export const openBrainAuth: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "device-bound", requires: ["gateway-launch", "desktop-mcp"],

  async detect(ctx): Promise<State> {
    const s = (ctx.opts as unknown as Opts).server;
    const details: string[] = [];
    if (!(await codeGrant(ctx, s))) details.push(`${D.code} — ${CODE_HINT(s)}`);
    if (!(await desktopGrant(ctx, s))) details.push(`${D.desktop} — ${DESK_HINT(s)}`);
    return details.length ? { kind: "absent", details } : { kind: "present" };
  },

  plan(ctx, state): Step[] {
    if (state.kind !== "absent") return [];
    const s = (ctx.opts as unknown as Opts).server;
    return [{ id: `${ID}.gate`, title: `Authorize Open Brain — ${CODE_HINT(s)}; ${DESK_HINT(s)}; press Enter when both are done`, interactive: true }];
  },

  async apply(ctx, steps) {
    for (const st of steps) {
      if (st.id !== `${ID}.gate`) throw new Error(`unknown step ${st.id}`);
      await ctx.prompt.gate(st.title);
      const after = await this.detect(ctx);
      if (after.kind === "present") { ctx.emit({ type: "note", level: "info", message: `${ID}: both grants present` }); continue; }
      const details = after.kind === "absent" ? (after.details ?? []) : [];
      ctx.emit({ type: "note", level: "warn", message: `${ID}: still missing — ${details.map((d) => d.split(" — ")[0]).join("; ")} (re-run bs doctor after authorizing)` });
    }
  },

  async verify(ctx): Promise<Check[]> {
    const s = (ctx.opts as unknown as Opts).server;
    const code = await codeGrant(ctx, s);
    const desk = (await desktopInstall(ctx.io, ctx.env.os, ctx.env.home)).installed && (await desktopGrant(ctx, s));
    return [
      code ? { id: "code", status: "ok", message: `Claude Code holds an Open Brain OAuth grant (${s})` } : { id: "code", status: "warn", message: `${D.code} — ${CODE_HINT(s)}` },
      desk ? { id: "desktop", status: "ok", message: `Claude Desktop holds an Open Brain OAuth grant (${s})` } : { id: "desktop", status: "warn", message: `${D.desktop} — ${DESK_HINT(s)}` },
    ];
  },

  async capture(ctx): Promise<Bundle> {
    const s = (ctx.opts as unknown as Opts).server;
    return { files: [], instructions: [`Authorize Open Brain on the target: Claude Code /mcp → ${s} → Authenticate; Claude Desktop Connectors → ${s} → Connect (OAuth grants are device-bound)`] };
  },
};
