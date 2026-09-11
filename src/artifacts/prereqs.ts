import type { Artifact, Bundle, Check, Ctx, State } from "../engine/artifact.ts";
import { desktopInstall, MIN_DESKTOP_VERSION, versionAtLeast } from "../engine/desktop.ts";
import type { Io } from "../engine/io.ts";

export async function nodeVersion(io: Io): Promise<{ major: number; minor: number; raw: string } | null> {
  const r = await io.exec("node", ["--version"]);
  if (r.code !== 0) return null;
  const raw = r.stdout.trim();
  const m = /^v(\d+)\.(\d+)/.exec(raw);
  return m ? { major: Number(m[1]), minor: Number(m[2]), raw } : null;
}

const CLAUDE_HINT = "native installer: curl -fsSL https://claude.ai/install.sh | bash  (→ ~/.local/bin/claude; then run `claude` once)";

async function checks(ctx: Ctx): Promise<Check[]> {
  const { io, env } = ctx;
  const out: Check[] = [];
  for (const t of ["git", "curl", "jq"]) {
    out.push((await io.which(t)) ? { id: t, status: "ok", message: `prereq: ${t}` } : { id: t, status: "error", message: `prereq missing: ${t} — install it, then re-run` });
  }
  const py = (await io.which("python3")) ?? (await io.which("python"));
  out.push(py ? { id: "python", status: "ok", message: `prereq: python (${py})` } : { id: "python", status: "error", message: "prereq missing: python3/python" });
  const nv = (await io.which("node")) ? await nodeVersion(io) : null;
  if (!nv) out.push({ id: "node", status: "error", message: "prereq missing: node ≥ 22.5" });
  else if (nv.major > 22 || (nv.major === 22 && nv.minor >= 5)) out.push({ id: "node", status: "ok", message: `prereq: node ${nv.raw}` });
  else out.push({ id: "node", status: "error", message: `node ${nv.raw} < 22.5 — upgrade node` });
  out.push((await io.which("claude")) ? { id: "claude", status: "ok", message: "prereq: claude" } : { id: "claude", status: "warn", message: `claude not found — ${CLAUDE_HINT}` });
  const d = await desktopInstall(io, env.os, env.home);
  if (!d.installed) out.push({ id: "desktop", status: "warn", message: `Claude Desktop not found at ${d.path} — install from https://claude.com/download (Windows: the .msix package; the .exe installer has no Cowork)` });
  else if (d.version && !versionAtLeast(d.version, MIN_DESKTOP_VERSION)) out.push({ id: "desktop", status: "warn", message: `Claude Desktop ${d.version} < ${MIN_DESKTOP_VERSION} — update it before the desktop artifacts run` });
  else out.push({ id: "desktop", status: "ok", message: d.version ? `Claude Desktop ${d.version} at ${d.path}` : `Claude Desktop at ${d.path} (version unknown)` });
  out.push({ id: "platform", status: "ok", message: `platform: ${env.os}` });
  return out;
}

export const prereqs: Artifact = {
  id: "prereqs", surfaces: ["code", "desktop"], portability: "device-bound", requires: [],
  async detect(ctx): Promise<State> {
    const hard = (await checks(ctx)).find((c) => c.status === "error");
    return hard ? { kind: "blocked", reason: hard.id === "node" ? "node < 22.5 or missing" : `missing ${hard.id}` } : { kind: "present" };
  },
  plan: () => [],
  async apply() {},
  verify: checks,
  async capture(): Promise<Bundle> {
    return { files: [], instructions: [
      "git, curl, jq, python3 (or python) and node ≥ 22.5 on PATH — platform package manager (dotfiles Brewfile / winget-packages.json)",
      `claude CLI — ${CLAUDE_HINT}`,
      "Claude Desktop ≥ 1.19367.0 — https://claude.com/download (macOS .dmg; Windows .msix)",
    ] };
  },
};
