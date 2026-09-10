import { createHash } from "node:crypto";
import { withOpts, type Bundle, type BundleFile, type Ctx, type Portability } from "./artifact.ts";
import type { Env } from "./env.ts";
import { selectArtifacts } from "./plan.ts";
import type { Profile } from "./profile.ts";

export interface ManifestArtifact { id: string; portability: Portability; files: string[]; sha256: Record<string, string> }
export interface Manifest { schema: 1; source: Env; captured_at: string; artifacts: ManifestArtifact[] }
export interface CaptureResult { manifest: Manifest; files: BundleFile[]; instructions: string }
export interface SecretHit { path: string; line: number; pattern: string }

/** Checked against every tracked dotclaude file on 2026-09-10: zero hits. `${…}` placeholders after `Bearer` are excluded on purpose. */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp; context?: RegExp }> = [
  { name: "anthropic-key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/ },
  { name: "bearer", re: /\bBearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{16,}/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "hex-64", re: /\b[0-9a-f]{64}\b/, context: /token|secret|key|auth|bearer|passw/i }, // mct sync tokens and hashed-secret shapes — only when the line also names a credential; a bare digest is not a secret
];

export class SecretScanError extends Error {
  constructor(public hits: SecretHit[]) {
    super(`refusing to write the bundle: ${hits.length} secret-shaped string(s) — ${hits.map((h) => `${h.path}:${h.line} (${h.pattern})`).join(", ")}`);
    this.name = "SecretScanError";
  }
}

export function scanForSecrets(files: BundleFile[]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const f of files) f.content.split(/\r?\n/).forEach((line, i) => {
    for (const p of SECRET_PATTERNS) if (p.re.test(line) && (!p.context || p.context.test(line))) hits.push({ path: f.path, line: i + 1, pattern: p.name });
  });
  return hits;
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const NEVER_FILES: ReadonlySet<Portability> = new Set(["device-bound", "non-transferable"]);
const safeRel = (p: string) => p.length > 0 && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.includes("\\") && !p.split("/").includes("..");

export async function captureBundle(profile: Profile, ctx: Ctx, now: Date = new Date()): Promise<CaptureResult> {
  const files: BundleFile[] = []; const seen = new Set<string>();
  const artifacts: ManifestArtifact[] = []; const sections: string[] = [];
  for (const a of selectArtifacts(profile)) {
    if (!a.capture) continue;
    const b: Bundle = await a.capture(withOpts(ctx, profile.options[a.id]));
    if (NEVER_FILES.has(a.portability) && b.files.length) throw new Error(`${a.id} is ${a.portability} and returned ${b.files.length} file(s) — refused`);
    const entry: ManifestArtifact = { id: a.id, portability: a.portability, files: [], sha256: {} };
    for (const f of b.files) {
      if (!safeRel(f.path)) throw new Error(`${a.id}: bundle paths must be relative posix without '..': ${JSON.stringify(f.path)}`);
      if (seen.has(f.path)) throw new Error(`${a.id}: duplicate bundle path ${f.path}`);
      seen.add(f.path); files.push(f); entry.files.push(f.path); entry.sha256[f.path] = sha256(f.content);
    }
    if (b.instructions.length) sections.push(`## ${a.id} (${a.portability})\n\n${b.instructions.map((i) => `- ${i}`).join("\n")}\n`);
    artifacts.push(entry);
    ctx.emit({ type: "note", level: "info", message: `captured ${a.id}: ${b.files.length} file(s)${b.instructions.length ? `, ${b.instructions.length} instruction(s)` : ""}` });
  }
  const hits = scanForSecrets(files);
  if (hits.length) throw new SecretScanError(hits);
  const instructions = `# boot-slapper — manual steps for ${ctx.env.label}\n\nCaptured ${now.toISOString()} from ${ctx.env.os} (${ctx.env.provider}). These items do not travel in the bundle; redo them on the target.\n\n${sections.join("\n") || "_nothing manual for this profile_\n"}`;
  return { manifest: { schema: 1, source: ctx.env, captured_at: now.toISOString(), artifacts }, files, instructions };
}
