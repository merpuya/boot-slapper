import path from "node:path";
import { desktopInstall } from "./desktop.ts";
import type { Io } from "./io.ts";

export type Provider = "subscription" | "gateway" | "api-key" | "bedrock" | "vertex";
export type Surface = "code" | "desktop";
export type Os = "darwin" | "win32" | "linux";

export interface Env { provider: Provider; surface: Surface; os: Os; home: string; label: string; claudeDir: string }

export interface EnvProbe {
  os: Os; home: string; hostname: string; label: string;
  detectedProvider: Provider | null;
  claudeOnPath: boolean; desktopInstalled: boolean; desktopVersion: string | null;
}

export function toOs(platform: NodeJS.Platform): Os {
  return platform === "darwin" ? "darwin" : platform === "win32" ? "win32" : "linux";
}

/** Join with the TARGET os's separator, not the host's — tests simulate win32 on a mac host. */
export const pj = (os: Os, ...parts: string[]) => (os === "win32" ? path.win32 : path.posix).join(...parts);

export function claudeDirOf(home: string, os: Os): string { return pj(os, home, ".claude"); }

export function desktopAppPath(os: Os, home: string): string {
  if (os === "darwin") return "/Applications/Claude.app";
  if (os === "win32") return pj(os, home, "AppData", "Local", "AnthropicClaude", "claude.exe");
  return pj(os, home, ".local", "share", "claude-desktop");
}

async function readJson(io: Io, p: string): Promise<Record<string, unknown> | null> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

// bootstrap.sh doctor (lines 197–212): DEVICE_LABEL env → settings.local.json → settings.json → hostname.
async function resolveLabel(io: Io, claudeDir: string, os: Os): Promise<string> {
  const fromEnv = io.env.DEVICE_LABEL;
  if (fromEnv) return fromEnv;
  for (const f of ["settings.local.json", "settings.json"]) {
    const j = await readJson(io, pj(os, claudeDir, f));
    const env = j?.env as Record<string, unknown> | undefined;
    const v = env?.DEVICE_LABEL;
    if (typeof v === "string" && v) return v;
  }
  return io.hostname;
}

async function detectProvider(io: Io, home: string, os: Os): Promise<Provider | null> {
  if (io.env.CLAUDE_CODE_USE_BEDROCK === "1") return "bedrock";
  if (io.env.CLAUDE_CODE_USE_VERTEX === "1") return "vertex";
  if (io.env.ANTHROPIC_BASE_URL || io.env.ANTHROPIC_AUTH_TOKEN) return "gateway";
  if (io.env.ANTHROPIC_API_KEY) return "api-key";
  const j = await readJson(io, pj(os, home, ".claude.json"));
  if (j && typeof j.oauthAccount === "object" && j.oauthAccount !== null) return "subscription";
  return null;
}

export async function probeEnv(io: Io): Promise<EnvProbe> {
  const os = toOs(io.platform);
  const home = io.home;
  const claudeDir = claudeDirOf(home, os);
  const desktop = await desktopInstall(io, os, home);
  return { os, home, hostname: io.hostname, label: await resolveLabel(io, claudeDir, os), detectedProvider: await detectProvider(io, home, os), claudeOnPath: (await io.which("claude")) !== null, desktopInstalled: desktop.installed, desktopVersion: desktop.version };
}

export function resolveEnv(probe: EnvProbe, provider: Provider, surface: Surface): Env {
  return { provider, surface, os: probe.os, home: probe.home, label: probe.label, claudeDir: claudeDirOf(probe.home, probe.os) };
}
