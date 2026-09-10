# boot-slapper Phase 1 — Engine + code-surface core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `bs` CLI (headless) that detects the environment, resolves a profile into a plan, applies the four foundation artifacts (`prereqs`, `claude-config`, `secrets`, `gateway-launch`) idempotently on macOS and Windows, and passes a doctor-parity gate against `dotclaude/bootstrap.sh --doctor`.

**Architecture:** A UI-free engine (`src/engine/`) resolves a `Profile` (ordered `Artifact` list) against a detected `Env` into a `Plan`; a run driver applies steps in DAG order and emits events; every filesystem/process access goes through an `Io` interface with a recording fake so artifacts are unit-tested without touching the machine. Secrets live behind a `SecretStore` with a Keychain backend (darwin) and a PasswordVault backend (win32); secret values never enter argv, events, or plan text.

**Tech Stack:** TypeScript 5.6, ESM, Node ≥ 22.5 (`node:util` parseArgs, `node:child_process`, `node:fs/promises`), vitest 3, tsx for dev. No runtime dependencies in Phase 1 (Ink arrives in Phase 2).

**Spec:** `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`

## Global Constraints

- Node `>=22.5.0`; `"type": "module"`; tsconfig mirrors me-count-token (`module: nodenext`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `strict`). Imports use `.ts` extensions.
- Nothing under `src/engine/` or `src/artifacts/` imports from `src/ui/` (spec §5).
- `detect` and `verify` never write. `apply` runs only steps `plan` produced. Re-running `apply` on a satisfied artifact yields an empty plan (spec §2 invariants 1, 2, 6).
- Adopt, never clobber: a differing file is reported `drifted` and left alone (invariant 3).
- No secret value in any `Step` text, event, log line, or child-process argv (invariant 4). Secret values pass to child processes via **stdin only**.
- Files are written with a trailing newline, JSON with 2-space indent, and backups named `<file>.bak.pre-<artifact>` before the first write in a run — matching the bash appliers.
- Device label resolution order: `DEVICE_LABEL` env → `settings.local.json` `env.DEVICE_LABEL` → `settings.json` `env.DEVICE_LABEL` → hostname (`bootstrap.sh` doctor, lines 197–212).
- Commit after every task with a conventional-commit subject; the session's attribution trailer is appended by the harness.

## Phase map

This plan is **Phase 1 of 3**. It ends with `bs env | plan | doctor | onboard --auto | secrets` working headless for the `code` surface and the parity gate (spec §6 gate 1) green. Phases 2 and 3 get their own plan files when this one lands:

- **Phase 2 — remaining code artifacts + TUI + bundle:** `project-memory`, `mct`, `plugins`, Ink screens (Plan/Apply/Doctor), `bs capture`, `install.sh` / `install.ps1` shims, TUI-vs-headless parity.
- **Phase 3 — desktop + cutover:** spikes S1/S2, `desktop-inference`, `desktop-mcp`, `desktop-skills`, `open-brain-auth`, `hosted-connectors`, gates 2–3 (bootstrap.sh shim, dotfiles handoff, claude-gw.zsh removal, memory-sync install.sh deprecation).

## File structure (Phase 1)

```
package.json, tsconfig.json, vitest.config.ts, .gitignore
src/
  cli.ts                      # parseArgs → command functions; nothing else
  engine/
    env.ts                    # Provider/Surface/Os/Env types, probeEnv(io), resolveEnv(probe, profile, surface)
    io.ts                     # Io interface, RealIo, FakeIo (recording)
    secrets/
      store.ts                # SecretService, SecretRef, SecretStore, selectStore(env, io)
      keychain.ts             # darwin: `security` — get via argv (value on stdout), set via `security -i` stdin
      passwordvault.ts        # win32: powershell PasswordVault, script on stdin
      filestore.ts            # linux fallback + the mecp-api-key file contract
    artifact.ts               # Portability, State, Step, Check, Ctx, Prompter, Artifact, resolveOrder()
    events.ts                 # EngineEvent union
    profile.ts                # Profile type
    plan.ts                   # resolvePlan(profile, ctx) → Plan
    run.ts                    # applyPlan(plan, ctx) → RunResult; verifyAll(profile, ctx)
    settings.ts               # pure: seedSettings(), renderHooks() — ports of the two bash appliers
  artifacts/
    prereqs.ts
    claude-config.ts
    secrets.ts
    gateway-launch.ts
    templates/
      claude-gw.zsh.ts        # exported string template
      claude-gw.ps1.ts
  profiles/
    aca34.ts
  ui/
    headless.ts               # event → console lines (==> ✓ ! ✗), run-log writer
    prompt.ts                 # tty prompter (hidden input) + InteractiveRequired
tests/
  unit/engine/*.test.ts
  unit/artifacts/*.test.ts
  parity/doctor-parity.test.ts
  fixtures/canonical-hooks.sample.json, settings.template.sample.json
.github/workflows/ci.yml
README.md
```

---

### Task 1: Scaffold + `Io` abstraction with recording fake

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/engine/io.ts`
- Test: `tests/unit/engine/io.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ExecResult { code: number; stdout: string; stderr: string }
  export interface ExecOpts { stdin?: string; cwd?: string; env?: Record<string, string> }
  export interface Io {
    readonly env: Record<string, string | undefined>;
    readonly platform: NodeJS.Platform;
    readonly home: string;
    readonly hostname: string;
    readFile(p: string): Promise<string | null>;                 // null when missing
    writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void>;
    copyFile(src: string, dst: string): Promise<void>;
    exists(p: string): Promise<boolean>;
    isDir(p: string): Promise<boolean>;
    mkdirp(p: string, opts?: { mode?: number }): Promise<void>;
    readdir(p: string): Promise<string[]>;                       // [] when missing
    exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
    which(cmd: string): Promise<string | null>;
  }
  export class RealIo implements Io
  export interface ExecCall { cmd: string; args: string[]; opts: ExecOpts }
  export class FakeIo implements Io {
    files: Map<string, string>; dirs: Set<string>; modes: Map<string, number>;
    calls: ExecCall[]; writes: string[];
    constructor(init?: { platform?: NodeJS.Platform; home?: string; hostname?: string; env?: Record<string,string|undefined>; files?: Record<string,string>; dirs?: string[]; path?: Record<string,string> });
    on(match: (cmd: string, args: string[]) => boolean, handler: (call: ExecCall) => ExecResult | Promise<ExecResult>): void;
  }
  ```

- [ ] **Step 1: Write package.json, tsconfig.json, vitest.config.ts**

`package.json`:
```json
{
  "name": "boot-slapper",
  "version": "0.1.0",
  "type": "module",
  "bin": { "bs": "dist/cli.js", "boot-slapper": "dist/cli.js" },
  "engines": { "node": ">=22.5.0" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "vitest run --exclude tests/parity",
    "test:parity": "vitest run tests/parity",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2023",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": false,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

Run: `npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 2: Write the failing FakeIo test**

`tests/unit/engine/io.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";

describe("FakeIo", () => {
  it("reads and writes files in memory and records writes", async () => {
    const io = new FakeIo({ files: { "/h/a.txt": "one\n" } });
    expect(await io.readFile("/h/a.txt")).toBe("one\n");
    expect(await io.readFile("/h/missing")).toBeNull();
    await io.writeFile("/h/b.txt", "two\n", { mode: 0o600 });
    expect(await io.readFile("/h/b.txt")).toBe("two\n");
    expect(io.modes.get("/h/b.txt")).toBe(0o600);
    expect(io.writes).toEqual(["/h/b.txt"]);
  });

  it("tracks directories via mkdirp and readdir", async () => {
    const io = new FakeIo({ dirs: ["/h/d"], files: { "/h/d/x": "", "/h/d/y": "" } });
    expect(await io.isDir("/h/d")).toBe(true);
    expect((await io.readdir("/h/d")).sort()).toEqual(["x", "y"]);
    expect(await io.readdir("/h/nope")).toEqual([]);
    await io.mkdirp("/h/new/deep");
    expect(await io.isDir("/h/new/deep")).toBe(true);
    expect(await io.isDir("/h/new")).toBe(true);
  });

  it("routes exec through registered handlers and records every call", async () => {
    const io = new FakeIo();
    io.on((c) => c === "git", () => ({ code: 0, stdout: "abc123\n", stderr: "" }));
    const r = await io.exec("git", ["rev-parse", "HEAD"], { cwd: "/h" });
    expect(r.stdout).toBe("abc123\n");
    expect(io.calls).toEqual([{ cmd: "git", args: ["rev-parse", "HEAD"], opts: { cwd: "/h" } }]);
  });

  it("returns code 127 for an unhandled command", async () => {
    const io = new FakeIo();
    const r = await io.exec("nope", []);
    expect(r.code).toBe(127);
  });

  it("resolves which() from the path map", async () => {
    const io = new FakeIo({ path: { git: "/usr/bin/git" } });
    expect(await io.which("git")).toBe("/usr/bin/git");
    expect(await io.which("jq")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/io.test.ts`
Expected: FAIL — cannot resolve `src/engine/io.ts`.

- [ ] **Step 4: Implement `src/engine/io.ts`**

```ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, hostname, platform as osPlatform } from "node:os";
import path from "node:path";

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface ExecOpts { stdin?: string; cwd?: string; env?: Record<string, string> }

export interface Io {
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly hostname: string;
  readFile(p: string): Promise<string | null>;
  writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  isDir(p: string): Promise<boolean>;
  mkdirp(p: string, opts?: { mode?: number }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  which(cmd: string): Promise<string | null>;
}

export class RealIo implements Io {
  readonly env = process.env;
  readonly platform = osPlatform();
  readonly home = homedir();
  readonly hostname = hostname();

  async readFile(p: string): Promise<string | null> {
    try { return await fs.readFile(p, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, s, { encoding: "utf8", mode: opts?.mode });
    if (opts?.mode !== undefined) await fs.chmod(p, opts.mode);
  }
  async copyFile(src: string, dst: string): Promise<void> { await fs.copyFile(src, dst); }
  async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }
  async isDir(p: string): Promise<boolean> {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  }
  async mkdirp(p: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(p, { recursive: true, mode: opts?.mode });
  }
  async readdir(p: string): Promise<string[]> {
    try { return await fs.readdir(p); } catch { return []; }
  }
  exec(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + String(e) }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
      child.stdin.end();
    });
  }
  async which(cmd: string): Promise<string | null> {
    const finder = this.platform === "win32" ? "where" : "which";
    const r = await this.exec(finder, [cmd]);
    if (r.code !== 0) return null;
    const first = r.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
    return first ? first.trim() : null;
  }
}

export interface ExecCall { cmd: string; args: string[]; opts: ExecOpts }
type Handler = (call: ExecCall) => ExecResult | Promise<ExecResult>;

export class FakeIo implements Io {
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly hostname: string;
  files: Map<string, string>;
  dirs: Set<string>;
  modes = new Map<string, number>();
  calls: ExecCall[] = [];
  writes: string[] = [];
  private handlers: Array<{ match: (cmd: string, args: string[]) => boolean; handler: Handler }> = [];
  private pathMap: Record<string, string>;

  constructor(init: {
    platform?: NodeJS.Platform; home?: string; hostname?: string;
    env?: Record<string, string | undefined>; files?: Record<string, string>;
    dirs?: string[]; path?: Record<string, string>;
  } = {}) {
    this.platform = init.platform ?? "darwin";
    this.home = init.home ?? "/h";
    this.hostname = init.hostname ?? "testbox";
    this.env = init.env ?? {};
    this.files = new Map(Object.entries(init.files ?? {}));
    this.dirs = new Set(init.dirs ?? []);
    for (const f of this.files.keys()) this.addParents(f);
    this.pathMap = init.path ?? {};
  }
  private addParents(p: string) {
    let d = path.posix.dirname(p);
    while (d && d !== "/" && d !== ".") { this.dirs.add(d); d = path.posix.dirname(d); }
  }
  on(match: (cmd: string, args: string[]) => boolean, handler: Handler) { this.handlers.push({ match, handler }); }

  async readFile(p: string) { return this.files.get(p) ?? null; }
  async writeFile(p: string, s: string, opts?: { mode?: number }) {
    this.files.set(p, s); this.addParents(p); this.writes.push(p);
    if (opts?.mode !== undefined) this.modes.set(p, opts.mode);
  }
  async copyFile(src: string, dst: string) {
    const s = this.files.get(src); if (s === undefined) throw new Error(`ENOENT ${src}`);
    await this.writeFile(dst, s);
  }
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async isDir(p: string) { return this.dirs.has(p); }
  async mkdirp(p: string) { this.dirs.add(p); this.addParents(p + "/x"); }
  async readdir(p: string) {
    if (!this.dirs.has(p)) return [];
    const out = new Set<string>();
    for (const f of this.files.keys()) if (path.posix.dirname(f) === p) out.add(path.posix.basename(f));
    for (const d of this.dirs) if (path.posix.dirname(d) === p) out.add(path.posix.basename(d));
    return [...out];
  }
  async exec(cmd: string, args: string[], opts: ExecOpts = {}) {
    const call = { cmd, args, opts }; this.calls.push(call);
    for (const h of this.handlers) if (h.match(cmd, args)) return h.handler(call);
    return { code: 127, stdout: "", stderr: `${cmd}: not handled` };
  }
  async which(cmd: string) { return this.pathMap[cmd] ?? null; }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/io.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/engine/io.ts tests/unit/engine/io.test.ts
git commit -m "feat(engine): scaffold + Io abstraction with recording fake"
```

---

### Task 2: Environment detection (`engine/env.ts`) + `Profile` type

**Files:**
- Create: `src/engine/env.ts`, `src/engine/profile.ts`
- Test: `tests/unit/engine/env.test.ts`

**Interfaces:**
- Consumes: `Io` (Task 1).
- Produces:
  ```ts
  export type Provider = "subscription" | "gateway" | "api-key" | "bedrock" | "vertex";
  export type Surface = "code" | "desktop";
  export type Os = "darwin" | "win32" | "linux";
  export interface Env { provider: Provider; surface: Surface; os: Os; home: string; label: string; claudeDir: string }
  export interface EnvProbe {
    os: Os; home: string; hostname: string; label: string;
    detectedProvider: Provider | null;       // from the process env / ~/.claude.json, null when nothing says
    claudeOnPath: boolean; desktopInstalled: boolean;
  }
  export function probeEnv(io: Io): Promise<EnvProbe>
  export function resolveEnv(probe: EnvProbe, provider: Provider, surface: Surface): Env
  export function desktopAppPath(os: Os, home: string): string
  export function claudeDirOf(home: string, os: Os): string
  export const pj: (os: Os, ...parts: string[]) => string     // join with the TARGET os separator
  // profile.ts
  export interface Profile {
    name: string; provider: Provider; surfaces: Surface[];
    artifacts: Artifact[];                       // Artifact from Task 3
    options: Record<string, Record<string, unknown>>;
  }
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/engine/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { desktopAppPath, probeEnv, resolveEnv } from "../../../src/engine/env.ts";

describe("probeEnv", () => {
  it("resolves the device label in the documented order", async () => {
    const a = new FakeIo({ env: { DEVICE_LABEL: "FROM-ENV" }, files: {
      "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }),
    } });
    expect((await probeEnv(a)).label).toBe("FROM-ENV");

    const b = new FakeIo({ files: {
      "/h/.claude/settings.local.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-LOCAL" } }),
      "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }),
    } });
    expect((await probeEnv(b)).label).toBe("FROM-LOCAL");

    const c = new FakeIo({ files: { "/h/.claude/settings.json": JSON.stringify({ env: { DEVICE_LABEL: "FROM-SETTINGS" } }) } });
    expect((await probeEnv(c)).label).toBe("FROM-SETTINGS");

    const d = new FakeIo({ hostname: "HOSTBOX" });
    expect((await probeEnv(d)).label).toBe("HOSTBOX");
  });

  it("detects the provider from the process env, then ~/.claude.json", async () => {
    expect((await probeEnv(new FakeIo({ env: { ANTHROPIC_BASE_URL: "https://gw" } }))).detectedProvider).toBe("gateway");
    expect((await probeEnv(new FakeIo({ env: { CLAUDE_CODE_USE_BEDROCK: "1" } }))).detectedProvider).toBe("bedrock");
    expect((await probeEnv(new FakeIo({ env: { CLAUDE_CODE_USE_VERTEX: "1" } }))).detectedProvider).toBe("vertex");
    expect((await probeEnv(new FakeIo({ env: { ANTHROPIC_API_KEY: "sk" } }))).detectedProvider).toBe("api-key");
    expect((await probeEnv(new FakeIo({ files: { "/h/.claude.json": JSON.stringify({ oauthAccount: { emailAddress: "x" } }) } }))).detectedProvider).toBe("subscription");
    expect((await probeEnv(new FakeIo())).detectedProvider).toBeNull();
  });

  it("reports claude on PATH and the Desktop app per OS", async () => {
    const mac = new FakeIo({ platform: "darwin", path: { claude: "/h/.local/bin/claude" }, dirs: ["/Applications/Claude.app"] });
    const p = await probeEnv(mac);
    expect(p.claudeOnPath).toBe(true);
    expect(p.desktopInstalled).toBe(true);
    expect(desktopAppPath("win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\AnthropicClaude\\claude.exe");
  });
});

describe("resolveEnv", () => {
  it("takes provider and surface from the profile, the rest from the probe", async () => {
    const probe = await probeEnv(new FakeIo({ hostname: "BOX" }));
    const env = resolveEnv(probe, "gateway", "code");
    expect(env).toEqual({ provider: "gateway", surface: "code", os: "darwin", home: "/h", label: "BOX", claudeDir: "/h/.claude" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/env.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/env.ts` and `src/engine/profile.ts`**

`src/engine/env.ts`:
```ts
import path from "node:path";
import type { Io } from "./io.ts";

export type Provider = "subscription" | "gateway" | "api-key" | "bedrock" | "vertex";
export type Surface = "code" | "desktop";
export type Os = "darwin" | "win32" | "linux";

export interface Env { provider: Provider; surface: Surface; os: Os; home: string; label: string; claudeDir: string }

export interface EnvProbe {
  os: Os; home: string; hostname: string; label: string;
  detectedProvider: Provider | null;
  claudeOnPath: boolean; desktopInstalled: boolean;
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
  return {
    os, home, hostname: io.hostname,
    label: await resolveLabel(io, claudeDir, os),
    detectedProvider: await detectProvider(io, home, os),
    claudeOnPath: (await io.which("claude")) !== null,
    desktopInstalled: await io.exists(desktopAppPath(os, home)),
  };
}

export function resolveEnv(probe: EnvProbe, provider: Provider, surface: Surface): Env {
  return { provider, surface, os: probe.os, home: probe.home, label: probe.label, claudeDir: claudeDirOf(probe.home, probe.os) };
}
```

`src/engine/profile.ts`:
```ts
import type { Artifact } from "./artifact.ts";
import type { Provider, Surface } from "./env.ts";

export interface Profile {
  name: string;
  provider: Provider;
  surfaces: Surface[];
  artifacts: Artifact[];
  options: Record<string, Record<string, unknown>>;
}
```

(`./artifact.ts` is created in Task 3; the import compiles once Task 3 lands — run this task's test only.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/env.test.ts`
Expected: 4 passed. (`path.join` on the darwin fake yields `/h/.claude`; the win32 assertion uses `path.win32` explicitly.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/env.ts src/engine/profile.ts tests/unit/engine/env.test.ts
git commit -m "feat(engine): environment probe + Env/Profile types"
```

---

### Task 3: Artifact contract, events, DAG resolver

**Files:**
- Create: `src/engine/artifact.ts`, `src/engine/events.ts`
- Test: `tests/unit/engine/artifact.test.ts`

**Interfaces:**
- Consumes: `Env` (Task 2), `Io` (Task 1), `SecretStore`/`SecretRef` (Task 4 — import type only; define the import now, Task 4 supplies the module).
- Produces:
  ```ts
  export type Portability = "portable" | "translatable" | "device-bound" | "non-transferable";
  export type State =
    | { kind: "absent"; details?: string[] }
    | { kind: "present" }
    | { kind: "drifted"; details: string[] }
    | { kind: "blocked"; reason: string };
  export interface Step { id: string; title: string; interactive?: boolean; secret?: SecretRef }
  export type CheckStatus = "ok" | "warn" | "error";
  export interface Check { id: string; status: CheckStatus; message: string }
  export interface Prompter {
    secret(label: string): Promise<string>;      // hidden input; throws InteractiveRequired when headless
    confirm(label: string): Promise<boolean>;
    gate(label: string): Promise<void>;          // "done, continue"
  }
  export class InteractiveRequired extends Error
  export interface Ctx { env: Env; io: Io; secrets: SecretStore; prompt: Prompter; interactive: boolean; opts: Record<string, unknown>; emit(e: EngineEvent): void }
  export interface Artifact {
    id: string; surfaces: Surface[]; portability: Portability; requires: string[];
    detect(ctx: Ctx): Promise<State>;
    plan(ctx: Ctx, state: State): Step[];
    apply(ctx: Ctx, steps: Step[]): Promise<void>;
    verify(ctx: Ctx): Promise<Check[]>;
  }
  export function resolveOrder(artifacts: Artifact[]): Artifact[]   // topological; throws on cycle or unknown id
  export function withOpts(ctx: Ctx, opts: Record<string, unknown> | undefined): Ctx
  // events.ts
  export type EngineEvent =
    | { type: "artifact:detected"; id: string; state: State }
    | { type: "artifact:skipped"; id: string; reason: string }
    | { type: "step:start"; artifact: string; step: Step }
    | { type: "step:done"; artifact: string; step: Step; ok: boolean; error?: string }
    | { type: "prompt:needed"; artifact: string; step: Step }
    | { type: "check:result"; artifact: string; check: Check }
    | { type: "note"; level: "info" | "warn" | "error"; message: string };
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/engine/artifact.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveOrder, type Artifact } from "../../../src/engine/artifact.ts";

const stub = (id: string, requires: string[] = []): Artifact => ({
  id, requires, surfaces: ["code"], portability: "portable",
  detect: async () => ({ kind: "present" }),
  plan: () => [],
  apply: async () => {},
  verify: async () => [],
});

describe("resolveOrder", () => {
  it("orders by dependencies, keeping declaration order among peers", () => {
    const order = resolveOrder([stub("c", ["a", "b"]), stub("a"), stub("b", ["a"])]).map((a) => a.id);
    expect(order).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    expect(() => resolveOrder([stub("a", ["b"]), stub("b", ["a"])])).toThrow(/cycle/);
  });
  it("throws on an unknown requirement", () => {
    expect(() => resolveOrder([stub("a", ["ghost"])])).toThrow(/unknown artifact "ghost"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/artifact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/events.ts` and `src/engine/artifact.ts`**

`src/engine/events.ts`:
```ts
import type { Check, State, Step } from "./artifact.ts";

export type EngineEvent =
  | { type: "artifact:detected"; id: string; state: State }
  | { type: "artifact:skipped"; id: string; reason: string }
  | { type: "step:start"; artifact: string; step: Step }
  | { type: "step:done"; artifact: string; step: Step; ok: boolean; error?: string }
  | { type: "prompt:needed"; artifact: string; step: Step }
  | { type: "check:result"; artifact: string; check: Check }
  | { type: "note"; level: "info" | "warn" | "error"; message: string };
```

`src/engine/artifact.ts`:
```ts
import type { Env, Surface } from "./env.ts";
import type { EngineEvent } from "./events.ts";
import type { Io } from "./io.ts";
import type { SecretRef, SecretStore } from "./secrets/store.ts";

export type Portability = "portable" | "translatable" | "device-bound" | "non-transferable";

export type State =
  | { kind: "absent"; details?: string[] }
  | { kind: "present" }
  | { kind: "drifted"; details: string[] }
  | { kind: "blocked"; reason: string };

export interface Step { id: string; title: string; interactive?: boolean; secret?: SecretRef }
export type CheckStatus = "ok" | "warn" | "error";
export interface Check { id: string; status: CheckStatus; message: string }

export class InteractiveRequired extends Error {
  constructor(label: string) { super(`interactive input required: ${label}`); this.name = "InteractiveRequired"; }
}

export interface Prompter {
  secret(label: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
  gate(label: string): Promise<void>;
}

export interface Ctx {
  env: Env; io: Io; secrets: SecretStore; prompt: Prompter; interactive: boolean;
  opts: Record<string, unknown>;
  emit(e: EngineEvent): void;
}

export interface Artifact {
  id: string;
  surfaces: Surface[];
  portability: Portability;
  requires: string[];
  detect(ctx: Ctx): Promise<State>;
  plan(ctx: Ctx, state: State): Step[];
  apply(ctx: Ctx, steps: Step[]): Promise<void>;
  verify(ctx: Ctx): Promise<Check[]>;
}

export function withOpts(ctx: Ctx, opts: Record<string, unknown> | undefined): Ctx {
  return { ...ctx, opts: opts ?? {} };
}

/** Kahn's algorithm; peers keep declaration order so plans are stable. */
export function resolveOrder(artifacts: Artifact[]): Artifact[] {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  for (const a of artifacts) for (const r of a.requires) {
    if (!byId.has(r)) throw new Error(`artifact "${a.id}" requires unknown artifact "${r}"`);
  }
  const indeg = new Map(artifacts.map((a) => [a.id, a.requires.length]));
  const out: Artifact[] = [];
  const ready = artifacts.filter((a) => a.requires.length === 0);
  while (ready.length) {
    const a = ready.shift()!;
    out.push(a);
    for (const b of artifacts) if (b.requires.includes(a.id)) {
      const n = indeg.get(b.id)! - 1; indeg.set(b.id, n);
      if (n === 0) ready.push(b);
    }
  }
  if (out.length !== artifacts.length) {
    const stuck = artifacts.filter((a) => !out.includes(a)).map((a) => a.id);
    throw new Error(`dependency cycle among artifacts: ${stuck.join(", ")}`);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/artifact.test.ts`
Expected: 3 passed. (The `secrets/store.ts` import is type-only and erased; vitest does not need the file yet.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/artifact.ts src/engine/events.ts tests/unit/engine/artifact.test.ts
git commit -m "feat(engine): artifact contract, events, DAG resolver"
```

---

### Task 4: SecretStore — Keychain (darwin), PasswordVault (win32), file fallback

**Files:**
- Create: `src/engine/secrets/store.ts`, `src/engine/secrets/keychain.ts`, `src/engine/secrets/passwordvault.ts`, `src/engine/secrets/filestore.ts`
- Test: `tests/unit/engine/secrets.test.ts`

**Interfaces:**
- Consumes: `Io`, `FakeIo` (Task 1); `Env` (Task 2).
- Produces:
  ```ts
  export type SecretService = "cornell-ai-gateway" | "mecp-device-token" | "mecp-api-key" | "mct-sync-token";
  export interface SecretRef { service: SecretService; account: string }
  export interface SecretStore {
    get(ref: SecretRef): Promise<string | null>;
    set(ref: SecretRef, value: string): Promise<void>;
    describe(ref: SecretRef): string;
  }
  export function selectStore(env: Env, io: Io): SecretStore     // composite: mecp-api-key → file contract, others → OS store
  export function defaultAccount(io: Io): string                 // $USER / $USERNAME / "user"
  export class KeychainStore implements SecretStore { constructor(io: Io) }
  export class PasswordVaultStore implements SecretStore { constructor(io: Io) }
  export class FileStore implements SecretStore { constructor(io: Io, dir: string) }   // <dir>/<service>, mode 600
  export const MECP_API_KEY_FILE = (home: string, os: Os) => pj(os, home, ".config", "mecp", "api_key")
  ```

`mecp-api-key` is the value `~/.claude/scripts/load-mecp-context.mjs` reads from `~/.config/mecp/api_key` (bootstrap.sh step 5). That file **is** the store for that one service on every OS, because the hook's contract is the file. The other three services use the OS store. (Spec §3 lists three services; this adds the fourth the hook already depends on — update the spec's enum in Task 13.)

- [ ] **Step 1: Write the failing test**

`tests/unit/engine/secrets.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { KeychainStore } from "../../../src/engine/secrets/keychain.ts";
import { PasswordVaultStore } from "../../../src/engine/secrets/passwordvault.ts";
import { FileStore } from "../../../src/engine/secrets/filestore.ts";
import { MECP_API_KEY_FILE, defaultAccount, selectStore } from "../../../src/engine/secrets/store.ts";
import { resolveEnv, probeEnv } from "../../../src/engine/env.ts";

const ref = { service: "cornell-ai-gateway" as const, account: "aca34" };

describe("KeychainStore", () => {
  it("get reads the value from stdout via argv (no secret in argv)", async () => {
    const io = new FakeIo();
    io.on((c, a) => c === "security" && a[0] === "find-generic-password", () => ({ code: 0, stdout: "s3cret\n", stderr: "" }));
    const v = await new KeychainStore(io).get(ref);
    expect(v).toBe("s3cret");
    expect(io.calls[0].args).toEqual(["find-generic-password", "-w", "-s", "cornell-ai-gateway", "-a", "aca34"]);
  });
  it("get returns null when the item is missing (exit 44)", async () => {
    const io = new FakeIo();
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "could not be found" }));
    expect(await new KeychainStore(io).get(ref)).toBeNull();
  });
  it("set passes the value on stdin through `security -i`, never argv", async () => {
    const io = new FakeIo();
    io.on((c) => c === "security", () => ({ code: 0, stdout: "", stderr: "" }));
    await new KeychainStore(io).set(ref, "it's a secret");
    const call = io.calls[0];
    expect(call.args).toEqual(["-i"]);
    expect(call.opts.stdin).toBe(`add-generic-password -U -s 'cornell-ai-gateway' -a 'aca34' -w 'it'\\''s a secret'\n`);
    expect(JSON.stringify(call.args)).not.toContain("secret");
  });
  it("describe names the Keychain item", () => {
    expect(new KeychainStore(new FakeIo()).describe(ref)).toBe("login Keychain item service=cornell-ai-gateway account=aca34");
  });
});

describe("PasswordVaultStore", () => {
  it("get runs a PowerShell script from stdin and reads stdout", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "s3cret\r\n", stderr: "" }));
    expect(await new PasswordVaultStore(io).get(ref)).toBe("s3cret");
    const call = io.calls[0];
    expect(call.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", "-"]);
    expect(call.opts.stdin).toContain("$v.Retrieve('cornell-ai-gateway','aca34')");
  });
  it("get returns null on exit 44", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 44, stdout: "", stderr: "" }));
    expect(await new PasswordVaultStore(io).get(ref)).toBeNull();
  });
  it("set embeds the value in the stdin script with single quotes doubled", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "", stderr: "" }));
    await new PasswordVaultStore(io).set(ref, "it's a secret");
    const call = io.calls[0];
    expect(call.opts.stdin).toContain("PasswordCredential('cornell-ai-gateway','aca34','it''s a secret')");
    expect(JSON.stringify(call.args)).not.toContain("secret");
  });
});

describe("FileStore", () => {
  it("writes <dir>/<service> mode 600 and reads it back trimmed", async () => {
    const io = new FakeIo();
    const s = new FileStore(io, "/h/.config/boot-slapper/secrets");
    expect(await s.get(ref)).toBeNull();
    await s.set(ref, "v");
    expect(io.files.get("/h/.config/boot-slapper/secrets/cornell-ai-gateway")).toBe("v\n");
    expect(io.modes.get("/h/.config/boot-slapper/secrets/cornell-ai-gateway")).toBe(0o600);
    expect(await s.get(ref)).toBe("v");
  });
});

describe("selectStore", () => {
  it("routes mecp-api-key to ~/.config/mecp/api_key on every OS and the rest to the OS store", async () => {
    const io = new FakeIo({ platform: "darwin", files: { "/h/.config/mecp/api_key": "k\n" } });
    const env = resolveEnv(await probeEnv(io), "gateway", "code");
    const store = selectStore(env, io);
    expect(await store.get({ service: "mecp-api-key", account: "x" })).toBe("k");
    expect(store.describe({ service: "mecp-api-key", account: "x" })).toBe(`file ${MECP_API_KEY_FILE("/h", "darwin")} (mode 600)`);
    expect(store.describe(ref)).toMatch(/Keychain/);
  });
  it("defaultAccount prefers USER, then USERNAME", () => {
    expect(defaultAccount(new FakeIo({ env: { USER: "aca34" } }))).toBe("aca34");
    expect(defaultAccount(new FakeIo({ env: { USERNAME: "aca34w" } }))).toBe("aca34w");
    expect(defaultAccount(new FakeIo())).toBe("user");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/secrets.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four modules**

`src/engine/secrets/store.ts`:
```ts
import path from "node:path";
import { pj, type Env, type Os } from "../env.ts";
import type { Io } from "../io.ts";
import { KeychainStore } from "./keychain.ts";
import { PasswordVaultStore } from "./passwordvault.ts";
import { FileStore, SingleFileStore } from "./filestore.ts";

export type SecretService = "cornell-ai-gateway" | "mecp-device-token" | "mecp-api-key" | "mct-sync-token";
export interface SecretRef { service: SecretService; account: string }

export interface SecretStore {
  get(ref: SecretRef): Promise<string | null>;
  set(ref: SecretRef, value: string): Promise<void>;
  describe(ref: SecretRef): string;
}

export const MECP_API_KEY_FILE = (home: string, os: Os) => pj(os, home, ".config", "mecp", "api_key");

export function defaultAccount(io: Io): string {
  return io.env.USER || io.env.USERNAME || "user";
}

function osStore(env: Env, io: Io): SecretStore {
  if (env.os === "darwin") return new KeychainStore(io);
  if (env.os === "win32") return new PasswordVaultStore(io);
  return new FileStore(io, path.join(env.home, ".config", "boot-slapper", "secrets"));
}

/** Composite: the hook-contract file for mecp-api-key, the OS store for everything else. */
export function selectStore(env: Env, io: Io): SecretStore {
  const os = osStore(env, io);
  const apiKey = new SingleFileStore(io, MECP_API_KEY_FILE(env.home, env.os));
  const pick = (ref: SecretRef) => (ref.service === "mecp-api-key" ? apiKey : os);
  return {
    get: (ref) => pick(ref).get(ref),
    set: (ref, v) => pick(ref).set(ref, v),
    describe: (ref) => pick(ref).describe(ref),
  };
}
```

`src/engine/secrets/keychain.ts`:
```ts
import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** macOS login Keychain. get: value arrives on stdout (argv carries only names). set: command line on stdin via `security -i`. */
export class KeychainStore implements SecretStore {
  constructor(private io: Io) {}
  async get(ref: SecretRef): Promise<string | null> {
    const r = await this.io.exec("security", ["find-generic-password", "-w", "-s", ref.service, "-a", ref.account]);
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string): Promise<void> {
    const line = `add-generic-password -U -s ${sq(ref.service)} -a ${sq(ref.account)} -w ${sq(value)}\n`;
    const r = await this.io.exec("security", ["-i"], { stdin: line });
    if (r.code !== 0) throw new Error(`security add-generic-password failed (${r.code}): ${r.stderr.trim()}`);
  }
  describe(ref: SecretRef): string {
    return `login Keychain item service=${ref.service} account=${ref.account}`;
  }
}
```

`src/engine/secrets/passwordvault.ts`:
```ts
import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

const ps = (s: string) => s.replace(/'/g, "''");
const PRELUDE = `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]\n$v = New-Object Windows.Security.Credentials.PasswordVault\n`;

/** Windows Credential Manager via PasswordVault (user-scoped, DPAPI). Script goes to PowerShell on stdin; argv carries no names or values. */
export class PasswordVaultStore implements SecretStore {
  constructor(private io: Io) {}
  private run(script: string) {
    return this.io.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdin: PRELUDE + script });
  }
  async get(ref: SecretRef): Promise<string | null> {
    const r = await this.run(
      `try { $c = $v.Retrieve('${ps(ref.service)}','${ps(ref.account)}'); $c.RetrievePassword(); Write-Output $c.Password } catch { exit 44 }\n`,
    );
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string): Promise<void> {
    const r = await this.run(
      `try { $old = $v.Retrieve('${ps(ref.service)}','${ps(ref.account)}'); $v.Remove($old) } catch {}\n` +
      `$v.Add((New-Object Windows.Security.Credentials.PasswordCredential('${ps(ref.service)}','${ps(ref.account)}','${ps(value)}')))\n`,
    );
    if (r.code !== 0) throw new Error(`PasswordVault add failed (${r.code}): ${r.stderr.trim()}`);
  }
  describe(ref: SecretRef): string {
    return `Windows Credential Manager (PasswordVault) resource=${ref.service} user=${ref.account}`;
  }
}
```

`src/engine/secrets/filestore.ts`:
```ts
import path from "node:path";
import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

/** One file per service under <dir>, mode 600. Linux fallback only. */
export class FileStore implements SecretStore {
  constructor(private io: Io, private dir: string) {}
  private file(ref: SecretRef) { return path.join(this.dir, ref.service); }
  async get(ref: SecretRef) {
    const s = await this.io.readFile(this.file(ref));
    const v = s?.trim() ?? "";
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string) {
    await this.io.mkdirp(this.dir, { mode: 0o700 });
    await this.io.writeFile(this.file(ref), value + "\n", { mode: 0o600 });
  }
  describe(ref: SecretRef) { return `file ${this.file(ref)} (mode 600)`; }
}

/** A single fixed file regardless of ref — the ~/.config/mecp/api_key hook contract. */
export class SingleFileStore implements SecretStore {
  constructor(private io: Io, private file: string) {}
  async get() {
    const s = await this.io.readFile(this.file);
    const v = s?.trim() ?? "";
    return v.length ? v : null;
  }
  async set(_ref: SecretRef, value: string) {
    await this.io.mkdirp(path.dirname(this.file), { mode: 0o700 });
    await this.io.writeFile(this.file, value + "\n", { mode: 0o600 });
  }
  describe() { return `file ${this.file} (mode 600)`; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/secrets.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Live smoke on this mac (throwaway item, cleaned up)**

Run:
```bash
node --input-type=module -e '
import { RealIo } from "./src/engine/io.ts";
import { KeychainStore } from "./src/engine/secrets/keychain.ts";
const s = new KeychainStore(new RealIo());
const ref = { service: "cornell-ai-gateway", account: "boot-slapper-test" };
await s.set(ref, "hunter2 with '"'"'quote");
console.log("get →", JSON.stringify(await s.get(ref)));
' --import tsx
security delete-generic-password -s cornell-ai-gateway -a boot-slapper-test >/dev/null && echo "cleaned"
```
Expected: `get → "hunter2 with 'quote"` then `cleaned`. (If `--import tsx` is unavailable, run via `npx tsx -e '…'`.)

- [ ] **Step 6: Commit**

```bash
git add src/engine/secrets tests/unit/engine/secrets.test.ts
git commit -m "feat(engine): SecretStore with Keychain, PasswordVault, and file backends"
```

---

### Task 5: Plan resolver and run driver

**Files:**
- Create: `src/engine/plan.ts`, `src/engine/run.ts`
- Test: `tests/unit/engine/run.test.ts`

**Interfaces:**
- Consumes: `Artifact`, `Ctx`, `State`, `Step`, `Check`, `resolveOrder`, `withOpts`, `InteractiveRequired` (Task 3); `Profile` (Task 2); `EngineEvent` (Task 3).
- Produces:
  ```ts
  export interface PlanEntry { artifact: Artifact; state: State; steps: Step[] }
  export type Plan = PlanEntry[];
  export async function resolvePlan(profile: Profile, ctx: Ctx, filter?: { only?: string[]; skip?: string[] }): Promise<Plan>
  export interface RunResult { applied: string[]; failed: string[]; skipped: string[]; checks: Record<string, Check[]> }
  export async function applyPlan(plan: Plan, ctx: Ctx): Promise<RunResult>
  export async function verifyAll(profile: Profile, ctx: Ctx): Promise<Record<string, Check[]>>
  export function worstStatus(checks: Record<string, Check[]>): "ok" | "warn" | "error"
  ```

Semantics (spec §7 error handling):
- `resolvePlan` filters artifacts to those whose `surfaces` intersect `profile.surfaces`, orders them, runs `detect` (emitting `artifact:detected`), then `plan`. A `blocked` state yields no steps.
- `applyPlan` walks the plan in order. An artifact whose `requires` includes a failed or blocked artifact is **skipped** (`artifact:skipped`, reason names the upstream). Steps run sequentially; the first failing step marks the artifact failed and the remaining steps of *that artifact* are not run. A step marked `interactive` when `ctx.interactive` is false is skipped with `note` level `warn` and does not fail the artifact. After apply, `verify` runs for every artifact that is present in the plan (including failed ones) so the doctor shows the true end state.

- [ ] **Step 1: Write the failing test**

`tests/unit/engine/run.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Artifact, Ctx, Step } from "../../../src/engine/artifact.ts";
import { InteractiveRequired } from "../../../src/engine/artifact.ts";
import type { EngineEvent } from "../../../src/engine/events.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "../../../src/engine/run.ts";
import { resolveEnv, probeEnv } from "../../../src/engine/env.ts";
import { selectStore } from "../../../src/engine/secrets/store.ts";
import type { Profile } from "../../../src/engine/profile.ts";

async function makeCtx(interactive = false): Promise<{ ctx: Ctx; events: EngineEvent[] }> {
  const io = new FakeIo();
  const env = resolveEnv(await probeEnv(io), "gateway", "code");
  const events: EngineEvent[] = [];
  const ctx: Ctx = {
    env, io, secrets: selectStore(env, io), interactive, opts: {},
    prompt: {
      secret: async (l) => { if (!interactive) throw new InteractiveRequired(l); return "v"; },
      confirm: async () => true, gate: async () => {},
    },
    emit: (e) => events.push(e),
  };
  return { ctx, events };
}

function art(id: string, o: { requires?: string[]; absent?: boolean; steps?: Step[]; failOn?: string; applied?: string[] }): Artifact {
  return {
    id, requires: o.requires ?? [], surfaces: ["code"], portability: "portable",
    detect: async () => (o.absent ? { kind: "absent" } : { kind: "present" }),
    plan: (_c, s) => (s.kind === "absent" ? (o.steps ?? [{ id: `${id}.do`, title: `do ${id}` }]) : []),
    apply: async (_c, steps) => {
      for (const s of steps) { if (s.id === o.failOn) throw new Error(`boom ${s.id}`); o.applied?.push(s.id); }
    },
    verify: async () => [{ id: `${id}.ok`, status: "ok", message: "fine" }],
  };
}

const profile = (artifacts: Artifact[]): Profile => ({ name: "t", provider: "gateway", surfaces: ["code"], artifacts, options: {} });

describe("resolvePlan", () => {
  it("emits detected states and empty steps for present artifacts", async () => {
    const { ctx, events } = await makeCtx();
    const plan = await resolvePlan(profile([art("a", {}), art("b", { absent: true })]), ctx);
    expect(plan.map((p) => [p.artifact.id, p.state.kind, p.steps.length])).toEqual([["a", "present", 0], ["b", "absent", 1]]);
    expect(events.filter((e) => e.type === "artifact:detected")).toHaveLength(2);
  });
  it("honours --only and --skip", async () => {
    const { ctx } = await makeCtx();
    const p = profile([art("a", {}), art("b", {}), art("c", {})]);
    expect((await resolvePlan(p, ctx, { only: ["b"] })).map((e) => e.artifact.id)).toEqual(["b"]);
    expect((await resolvePlan(p, ctx, { skip: ["b"] })).map((e) => e.artifact.id)).toEqual(["a", "c"]);
  });
  it("excludes artifacts for surfaces the profile does not target", async () => {
    const { ctx } = await makeCtx();
    const d: Artifact = { ...art("d", {}), surfaces: ["desktop"] };
    expect((await resolvePlan(profile([art("a", {}), d]), ctx)).map((e) => e.artifact.id)).toEqual(["a"]);
  });
});

describe("applyPlan", () => {
  it("applies in order, skips dependents of a failed artifact, and still verifies everything", async () => {
    const { ctx, events } = await makeCtx();
    const applied: string[] = [];
    const a = art("a", { absent: true, applied, steps: [{ id: "a.1", title: "" }, { id: "a.2", title: "" }], failOn: "a.2" });
    const b = art("b", { absent: true, applied, requires: ["a"] });
    const c = art("c", { absent: true, applied });
    const res = await applyPlan(await resolvePlan(profile([a, b, c]), ctx), ctx);
    expect(applied).toEqual(["a.1", "c.do"]);
    expect(res.failed).toEqual(["a"]);
    expect(res.skipped).toEqual(["b"]);
    expect(res.applied).toEqual(["c"]);
    expect(Object.keys(res.checks).sort()).toEqual(["a", "b", "c"]);
    const done = events.filter((e) => e.type === "step:done") as Extract<EngineEvent, { type: "step:done" }>[];
    expect(done.find((e) => e.step.id === "a.2")?.ok).toBe(false);
    expect(done.find((e) => e.step.id === "a.2")?.error).toMatch(/boom a.2/);
    expect(events.find((e) => e.type === "artifact:skipped")).toMatchObject({ id: "b", reason: 'requires "a" which failed' });
  });
  it("skips interactive steps headlessly with a warning instead of failing", async () => {
    const { ctx, events } = await makeCtx(false);
    const applied: string[] = [];
    const a = art("a", { absent: true, applied, steps: [{ id: "a.ask", title: "ask", interactive: true }, { id: "a.2", title: "" }] });
    const res = await applyPlan(await resolvePlan(profile([a]), ctx), ctx);
    expect(applied).toEqual(["a.2"]);
    expect(res.failed).toEqual([]);
    expect(events.find((e) => e.type === "note" && e.level === "warn")).toBeTruthy();
  });
});

describe("verifyAll / worstStatus", () => {
  it("collects checks per artifact and folds to the worst status", async () => {
    const { ctx } = await makeCtx();
    const checks = await verifyAll(profile([art("a", {}), art("b", {})]), ctx);
    expect(checks.a[0].status).toBe("ok");
    expect(worstStatus(checks)).toBe("ok");
    expect(worstStatus({ x: [{ id: "x", status: "warn", message: "" }], y: [{ id: "y", status: "error", message: "" }] })).toBe("error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/run.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/engine/plan.ts` and `src/engine/run.ts`**

`src/engine/plan.ts`:
```ts
import { resolveOrder, withOpts, type Artifact, type Ctx, type State, type Step } from "./artifact.ts";
import type { Profile } from "./profile.ts";

export interface PlanEntry { artifact: Artifact; state: State; steps: Step[] }
export type Plan = PlanEntry[];

export function selectArtifacts(profile: Profile, filter: { only?: string[]; skip?: string[] } = {}): Artifact[] {
  const onSurface = profile.artifacts.filter((a) => a.surfaces.some((s) => profile.surfaces.includes(s)));
  const ordered = resolveOrder(onSurface);
  return ordered.filter((a) => (!filter.only || filter.only.includes(a.id)) && !(filter.skip ?? []).includes(a.id));
}

export async function resolvePlan(profile: Profile, ctx: Ctx, filter: { only?: string[]; skip?: string[] } = {}): Promise<Plan> {
  const plan: Plan = [];
  for (const artifact of selectArtifacts(profile, filter)) {
    const c = withOpts(ctx, profile.options[artifact.id]);
    const state = await artifact.detect(c);
    ctx.emit({ type: "artifact:detected", id: artifact.id, state });
    const steps = state.kind === "blocked" ? [] : artifact.plan(c, state);
    plan.push({ artifact, state, steps });
  }
  return plan;
}
```

`src/engine/run.ts`:
```ts
import { withOpts, type Check, type Ctx } from "./artifact.ts";
import type { Profile } from "./profile.ts";
import { selectArtifacts, type Plan } from "./plan.ts";
export { resolvePlan } from "./plan.ts";

export interface RunResult { applied: string[]; failed: string[]; skipped: string[]; checks: Record<string, Check[]> }

export async function applyPlan(plan: Plan, ctx: Ctx): Promise<RunResult> {
  const res: RunResult = { applied: [], failed: [], skipped: [], checks: {} };
  const bad = new Map<string, string>(); // artifact id → why it can't be built on

  for (const entry of plan) {
    const { artifact, state } = entry;
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[artifact.id]);
    if (state.kind === "blocked") {
      bad.set(artifact.id, "blocked");
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: `blocked: ${state.reason}` });
      res.skipped.push(artifact.id);
      continue;
    }
    const upstream = artifact.requires.find((r) => bad.has(r));
    if (upstream) {
      bad.set(artifact.id, `requires "${upstream}"`);
      ctx.emit({ type: "artifact:skipped", id: artifact.id, reason: `requires "${upstream}" which ${bad.get(upstream) === "blocked" ? "is blocked" : "failed"}` });
      res.skipped.push(artifact.id);
      continue;
    }
    const runnable = entry.steps.filter((s) => {
      if (s.interactive && !ctx.interactive) {
        ctx.emit({ type: "note", level: "warn", message: `${artifact.id}: skipping "${s.title}" — needs an interactive session` });
        return false;
      }
      return true;
    });
    let failed = false;
    for (const step of runnable) {
      ctx.emit({ type: "step:start", artifact: artifact.id, step });
      try {
        await artifact.apply(c, [step]);
        ctx.emit({ type: "step:done", artifact: artifact.id, step, ok: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        ctx.emit({ type: "step:done", artifact: artifact.id, step, ok: false, error });
        failed = true;
        break;
      }
    }
    if (failed) { bad.set(artifact.id, "failed"); res.failed.push(artifact.id); }
    else if (runnable.length > 0) res.applied.push(artifact.id);
  }
  for (const entry of plan) {
    const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[entry.artifact.id]);
    const checks = await entry.artifact.verify(c);
    for (const check of checks) ctx.emit({ type: "check:result", artifact: entry.artifact.id, check });
    res.checks[entry.artifact.id] = checks;
  }
  return res;
}

export async function verifyAll(profile: Profile, ctx: Ctx): Promise<Record<string, Check[]>> {
  const out: Record<string, Check[]> = {};
  for (const artifact of selectArtifacts(profile)) {
    const c = withOpts(ctx, profile.options[artifact.id]);
    const checks = await artifact.verify(c);
    for (const check of checks) ctx.emit({ type: "check:result", artifact: artifact.id, check });
    out[artifact.id] = checks;
  }
  return out;
}

export function worstStatus(checks: Record<string, Check[]>): "ok" | "warn" | "error" {
  const all = Object.values(checks).flat();
  if (all.some((c) => c.status === "error")) return "error";
  if (all.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
```

Note on options: `applyPlan` receives per-artifact options through `ctx.opts` keyed by artifact id (the CLI sets `ctx.opts = profile.options` before calling — Task 11). `resolvePlan` reads them from the profile directly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/run.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan.ts src/engine/run.ts tests/unit/engine/run.test.ts
git commit -m "feat(engine): plan resolver and run driver with DAG skip semantics"
```

---

### Task 6: Pure ports of the settings appliers (`engine/settings.ts`)

**Files:**
- Create: `src/engine/settings.ts`
- Create: `tests/fixtures/canonical-hooks.sample.json`, `tests/fixtures/settings.template.sample.json`
- Test: `tests/unit/engine/settings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MANAGED_KEYS: ReadonlySet<string>          // {"statusLine"} — apply-settings-template.sh MANAGED
  export interface SeedResult { next: Record<string, unknown>; added: string[]; stale: string[] }
  export function seedSettings(settings: Record<string, unknown> | null, template: Record<string, unknown>): SeedResult
  export type HooksBlock = Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>
  export interface RenderOpts { platform: Os; nodeExe?: string; homeWin?: string }
  export function renderHooks(canonical: HooksBlock, opts: RenderOpts): HooksBlock
  export function stableJson(v: unknown): string      // JSON.stringify(v, null, 2) + "\n"
  export function deepEqual(a: unknown, b: unknown): boolean
  ```

These are line-for-line ports of `~/.claude/scripts/apply-settings-template.sh` (seed-only + MANAGED reconcile; refuse a template with `hooks`) and `~/.claude/scripts/apply-canonical-hooks.sh` (the `platforms` filter, key stripping, empty group/event dropping, and the win32 exec-form rewrite of `node "$HOME/<rel>.mjs" [args]`).

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/settings.template.sample.json` — copy of the live template:
```json
{
  "permissions": { "defaultMode": "auto" },
  "model": "fable",
  "statusLine": { "type": "command", "command": "node \"$HOME/.claude/statusline.mjs\"" },
  "askUserQuestionTimeout": "never",
  "tui": "fullscreen",
  "theme": "auto"
}
```

`tests/fixtures/canonical-hooks.sample.json` — a reduced canonical with every shape the renderer must handle:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write", "hooks": [ { "type": "command", "command": "node \"$HOME/.claude/scripts/pretool-write-untracked-guard.mjs\"", "timeout": 5 } ] },
      { "hooks": [ { "type": "command", "command": "[ -x \"$HOME/.config/iterm2/cc-status\" ] || exit 0; exec \"$HOME/.config/iterm2/cc-status\"", "platforms": ["darwin"] } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command", "command": "[ -x \"$HOME/.config/iterm2/cc-status\" ] || exit 0; exec \"$HOME/.config/iterm2/cc-status\"", "platforms": ["darwin"] } ] }
    ],
    "SessionStart": [
      { "matcher": "startup", "hooks": [
        { "type": "command", "command": "$HOME/.claude/scripts/dotclaude-self-update.sh", "timeout": 15 },
        { "type": "command", "command": "node \"$HOME/.claude/scripts/memory-auto-sync.mjs\" start", "timeout": 30 }
      ] }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/engine/settings.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepEqual, renderHooks, seedSettings, stableJson, type HooksBlock } from "../../../src/engine/settings.ts";

const template = JSON.parse(readFileSync("tests/fixtures/settings.template.sample.json", "utf8"));
const canonical = JSON.parse(readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8")).hooks as HooksBlock;
const allHooks = (b: HooksBlock) => Object.values(b).flatMap((gs) => gs.flatMap((g) => g.hooks));

describe("seedSettings", () => {
  it("seeds a missing settings.json wholesale", () => {
    const r = seedSettings(null, template);
    expect(r.next).toEqual(template);
    expect(r.added.sort()).toEqual(Object.keys(template).sort());
    expect(r.stale).toEqual([]);
  });
  it("fills only missing keys and never overwrites machine-local values", () => {
    const r = seedSettings({ model: "opus", permissions: { defaultMode: "plan" } }, template);
    expect(r.next.model).toBe("opus");
    expect(r.next.permissions).toEqual({ defaultMode: "plan" });
    expect(r.added.sort()).toEqual(["askUserQuestionTimeout", "statusLine", "theme", "tui"]);
  });
  it("reconciles drifted MANAGED keys (statusLine) and reports them as stale", () => {
    const r = seedSettings({ ...template, statusLine: { type: "command", command: "bash /mnt/c/old.sh" } }, template);
    expect(r.stale).toEqual(["statusLine"]);
    expect(r.next.statusLine).toEqual(template.statusLine);
  });
  it("is a no-op when everything is present", () => {
    const r = seedSettings({ ...template, hooks: { x: [] } }, template);
    expect(r.added).toEqual([]); expect(r.stale).toEqual([]);
    expect(r.next).toEqual({ ...template, hooks: { x: [] } });
  });
  it("refuses a template that carries hooks", () => {
    expect(() => seedSettings({}, { ...template, hooks: {} })).toThrow(/hooks are owned by canonical-hooks.json/);
  });
});

describe("renderHooks", () => {
  it("darwin: keeps everything, strips `platforms`, keeps shell form", () => {
    const r = renderHooks(canonical, { platform: "darwin" });
    expect(Object.keys(r).sort()).toEqual(["Notification", "PreToolUse", "SessionStart"]);
    expect(allHooks(r)).toHaveLength(5);
    expect(allHooks(r).every((h) => !("platforms" in h) && !("args" in h))).toBe(true);
  });
  it("win32: drops darwin-only hooks, drops emptied groups/events, rewrites node hooks to exec form", () => {
    const r = renderHooks(canonical, { platform: "win32", nodeExe: "C:\\Program Files\\nodejs\\node.exe", homeWin: "C:\\Users\\test" });
    expect(Object.keys(r).sort()).toEqual(["PreToolUse", "SessionStart"]);
    expect(r.PreToolUse).toHaveLength(1);
    expect(r.PreToolUse[0].hooks[0]).toEqual({
      type: "command", timeout: 5,
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\test\\.claude\\scripts\\pretool-write-untracked-guard.mjs"],
    });
    const start = r.SessionStart[0].hooks;
    expect(start[0]).toEqual({ type: "command", command: "$HOME/.claude/scripts/dotclaude-self-update.sh", timeout: 15 });
    expect(start[1]).toEqual({
      type: "command", timeout: 30,
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\test\\.claude\\scripts\\memory-auto-sync.mjs", "start"],
    });
    expect(JSON.stringify(r)).not.toContain("cc-status");
  });
  it("win32 without nodeExe/homeWin leaves shell form untouched (filter still applies)", () => {
    const r = renderHooks(canonical, { platform: "win32" });
    expect(allHooks(r).every((h) => !("args" in h))).toBe(true);
    expect(JSON.stringify(r)).not.toContain("cc-status");
  });
  it("linux: same as win32 filter, no exec rewrite", () => {
    const r = renderHooks(canonical, { platform: "linux" });
    expect(Object.keys(r).sort()).toEqual(["PreToolUse", "SessionStart"]);
    expect(allHooks(r).every((h) => !("args" in h))).toBe(true);
  });
});

describe("helpers", () => {
  it("stableJson ends with a newline and deepEqual compares structurally", () => {
    expect(stableJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/engine/settings.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/settings.test.ts`
Expected: 10 passed.

- [ ] **Step 6: Cross-check against the real applier on this mac**

Run:
```bash
DOTCLAUDE_PLATFORM=win32 DOTCLAUDE_NODE_EXE='C:\Program Files\nodejs\node.exe' DOTCLAUDE_HOME_WIN='C:\Users\test' DOTCLAUDE_RENDER_ONLY=1 \
  bash ~/.claude/scripts/apply-canonical-hooks.sh '' ~/.claude/scripts/canonical-hooks.json > /tmp/bs-bash-win32.json
npx tsx -e '
import { readFileSync } from "node:fs";
import { renderHooks } from "./src/engine/settings.ts";
const c = JSON.parse(readFileSync(process.env.HOME + "/.claude/scripts/canonical-hooks.json", "utf8")).hooks;
const r = renderHooks(c, { platform: "win32", nodeExe: "C:\\Program Files\\nodejs\\node.exe", homeWin: "C:\\Users\\test" });
process.stdout.write(JSON.stringify(r, Object.keys(r).sort(), 2) + "\n");
' > /tmp/bs-ts-win32.json
python3 -c "import json,sys; a=json.load(open('/tmp/bs-bash-win32.json')); b=json.load(open('/tmp/bs-ts-win32.json')); print('IDENTICAL' if a==b else 'DIFF'); sys.exit(0 if a==b else 1)"
```
Expected: `IDENTICAL`. (If it prints DIFF, the port is wrong — diff the two files and fix `renderHooks`; do not adjust the bash.)

- [ ] **Step 7: Commit**

```bash
git add src/engine/settings.ts tests/fixtures tests/unit/engine/settings.test.ts
git commit -m "feat(engine): pure ports of the settings template and canonical hooks appliers"
```

---

### Task 7: Artifact `prereqs`

**Files:**
- Create: `src/artifacts/prereqs.ts`
- Test: `tests/unit/artifacts/prereqs.test.ts`

**Interfaces:**
- Consumes: `Artifact`, `Ctx`, `Check`, `State` (Task 3); `desktopAppPath` (Task 2).
- Produces: `export const prereqs: Artifact` (id `prereqs`, surfaces `["code","desktop"]`, portability `device-bound`, requires `[]`); `export async function nodeVersion(io: Io): Promise<{ major: number; minor: number } | null>`.

Behaviour (bootstrap.sh step 1 + doctor prereq lines): `git`, `curl`, `jq`, `python3|python`, `node ≥ 22.5` are **errors**; `claude` and the Desktop app are **warnings** with the install hint. `detect` returns `blocked` naming the first missing hard prerequisite (so dependents are skipped), else `present`. `plan` is always `[]` — this artifact never installs anything.

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/prereqs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { prereqs } from "../../../src/artifacts/prereqs.ts";
import { makeCtx } from "../helpers.ts";

const allTools = { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", claude: "/h/.local/bin/claude" };

describe("prereqs", () => {
  it("is present and all-ok when every tool exists", async () => {
    const { ctx, io } = await makeCtx({ path: allTools, dirs: ["/Applications/Claude.app"] });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect(await prereqs.detect(ctx)).toEqual({ kind: "present" });
    expect(prereqs.plan(ctx, { kind: "present" })).toEqual([]);
    const checks = await prereqs.verify(ctx);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(["git", "curl", "jq", "python", "node", "claude", "desktop", "platform"]);
  });
  it("blocks on a missing hard prerequisite and names it", async () => {
    const { ctx, io } = await makeCtx({ path: { ...allTools, jq: undefined as unknown as string } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect(await prereqs.detect(ctx)).toEqual({ kind: "blocked", reason: "missing jq" });
    expect((await prereqs.verify(ctx)).find((c) => c.id === "jq")).toMatchObject({ status: "error" });
  });
  it("treats node < 22.5 as an error and a missing claude/desktop as warnings", async () => {
    const { ctx, io } = await makeCtx({ path: { ...allTools, claude: undefined as unknown as string } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v20.11.1\n", stderr: "" }));
    const checks = await prereqs.verify(ctx);
    expect(checks.find((c) => c.id === "node")).toMatchObject({ status: "error", message: expect.stringMatching(/v20\.11\.1 < 22\.5/) });
    expect(checks.find((c) => c.id === "claude")).toMatchObject({ status: "warn", message: expect.stringMatching(/claude\.ai\/install\.sh/) });
    expect(checks.find((c) => c.id === "desktop")).toMatchObject({ status: "warn" });
  });
  it("accepts `python` when `python3` is absent (Git Bash on Windows)", async () => {
    const { ctx, io } = await makeCtx({ platform: "win32", home: "C:\\Users\\t", path: { ...allTools, python3: undefined as unknown as string, python: "C:\\py\\python.exe" } });
    io.on((c) => c === "node", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
    expect((await prereqs.verify(ctx)).find((c) => c.id === "python")).toMatchObject({ status: "ok" });
  });
});
```

`tests/unit/helpers.ts` (shared by every artifact test from here on):
```ts
import { InteractiveRequired, type Ctx } from "../../src/engine/artifact.ts";
import { probeEnv, resolveEnv, type Provider, type Surface } from "../../src/engine/env.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { FakeIo } from "../../src/engine/io.ts";
import { selectStore } from "../../src/engine/secrets/store.ts";

type FakeInit = ConstructorParameters<typeof FakeIo>[0];

export async function makeCtx(init: FakeInit & { provider?: Provider; surface?: Surface; interactive?: boolean; opts?: Record<string, unknown>; answers?: Record<string, string> } = {}) {
  const io = new FakeIo(init);
  // FakeIo.which reads pathMap; a key mapped to undefined means "not on PATH".
  const env = resolveEnv(await probeEnv(io), init.provider ?? "gateway", init.surface ?? "code");
  const events: EngineEvent[] = [];
  const interactive = init.interactive ?? false;
  const ctx: Ctx = {
    env, io, secrets: selectStore(env, io), interactive, opts: init.opts ?? {},
    prompt: {
      secret: async (label) => { if (!interactive) throw new InteractiveRequired(label); return init.answers?.[label] ?? ""; },
      confirm: async () => true,
      gate: async () => {},
    },
    emit: (e) => events.push(e),
  };
  return { ctx, io, env, events };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/prereqs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/prereqs.ts`**

```ts
import type { Artifact, Check, Ctx, State } from "../engine/artifact.ts";
import { desktopAppPath } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";

export async function nodeVersion(io: Io): Promise<{ major: number; minor: number } | null> {
  const r = await io.exec("node", ["--version"]);
  const m = /^v(\d+)\.(\d+)/.exec(r.stdout.trim());
  return r.code === 0 && m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
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
  const nodeRaw = (await io.which("node")) ? (await io.exec("node", ["--version"])).stdout.trim() : "";
  const nv = /^v(\d+)\.(\d+)/.exec(nodeRaw);
  const [major, minor] = nv ? [Number(nv[1]), Number(nv[2])] : [0, 0];
  if (!nv) out.push({ id: "node", status: "error", message: "prereq missing: node ≥ 22.5" });
  else if (major > 22 || (major === 22 && minor >= 5)) out.push({ id: "node", status: "ok", message: `prereq: node ${nodeRaw}` });
  else out.push({ id: "node", status: "error", message: `node ${nodeRaw} < 22.5 — upgrade node` });
  out.push((await io.which("claude")) ? { id: "claude", status: "ok", message: "prereq: claude" } : { id: "claude", status: "warn", message: `claude not found — ${CLAUDE_HINT}` });
  const app = desktopAppPath(env.os, env.home);
  out.push((await io.exists(app)) ? { id: "desktop", status: "ok", message: `Claude Desktop: ${app}` } : { id: "desktop", status: "warn", message: `Claude Desktop not found at ${app} — install from https://claude.com/download` });
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
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/prereqs.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/prereqs.ts tests/unit/helpers.ts tests/unit/artifacts/prereqs.test.ts
git commit -m "feat(artifacts): prereqs"
```

---

### Task 8: Artifact `claude-config` (checkout + settings + hooks)

**Files:**
- Create: `src/artifacts/claude-config.ts`
- Test: `tests/unit/artifacts/claude-config.test.ts`

**Interfaces:**
- Consumes: `seedSettings`, `renderHooks`, `stableJson`, `deepEqual` (Task 6); `Artifact`, `Ctx`, `State`, `Step`, `Check` (Task 3).
- Options (`profile.options["claude-config"]`): `{ sshUrl: string; httpsUrl: string }`.
- Produces: `export const claudeConfig: Artifact` (id `claude-config`, surfaces `["code"]`, `portable`, requires `["prereqs"]`); helpers `isCheckout(io, dir)`, `cloneUrl(io, ssh, https)`.

Step ids: `claude-config.clone` | `.adopt` | `.pull` | `.settings` | `.hooks`.

Detection rules:
- `~/.claude` missing → `absent` (details: "~/.claude absent — will clone").
- exists, not a checkout (`git -C dir rev-parse --show-toplevel` ≠ dir after normalising slashes/case) → `absent` (details: "exists but is not a checkout — will adopt in place").
- checkout: gather drift details — tracked modifications from `git status --porcelain` (reported, never fixed), behind origin (`git ls-remote origin refs/heads/main` vs `git rev-parse HEAD`; a failed ls-remote is a warn note, treated as up to date), template keys missing/stale (`seedSettings`), hooks ≠ rendered canonical. Any of the *fixable* ones (behind, template, hooks) → `drifted` with steps; only tracked modifications → `drifted` with **no** steps (adopt-never-clobber); nothing → `present`.

Apply rules mirror `bootstrap.sh` lines 335–370 and the two appliers; backups are `settings.json.bak.pre-settings-template` and `settings.json.bak.pre-canonical-hooks`, only when the file existed.

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/claude-config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { claudeConfig } from "../../../src/artifacts/claude-config.ts";
import { makeCtx } from "../helpers.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { readFileSync } from "node:fs";

const template = readFileSync("tests/fixtures/settings.template.sample.json", "utf8");
const canonical = readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8");
const opts = { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" };
const HEAD = "abc123\n";

/** A git fake: `state` decides what rev-parse/status/ls-remote answer. */
function gitFake(io: FakeIo, state: { checkout: boolean; porcelain?: string; remoteHead?: string }) {
  io.on((c, a) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "Hi merpuya! You've successfully authenticated" }));
  io.on((c) => c === "git", ({ args }) => {
    const sub = args[args.indexOf("-C") >= 0 ? 2 : 0];
    if (sub === "rev-parse" && args.includes("--show-toplevel")) return state.checkout ? { code: 0, stdout: "/h/.claude\n", stderr: "" } : { code: 128, stdout: "", stderr: "not a git repository" };
    if (sub === "rev-parse") return { code: 0, stdout: HEAD, stderr: "" };
    if (sub === "status") return { code: 0, stdout: state.porcelain ?? "", stderr: "" };
    if (sub === "ls-remote") return { code: 0, stdout: `${state.remoteHead ?? "abc123"}\trefs/heads/main\n`, stderr: "" };
    if (sub === "clone") { io.dirs.add("/h/.claude"); state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    if (sub === "init") { state.checkout = true; return { code: 0, stdout: "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  });
}
const tracked = () => ({ "/h/.claude/scripts/settings.template.json": template, "/h/.claude/scripts/canonical-hooks.json": canonical });

describe("claude-config", () => {
  it("fresh box: clone → seed settings → write hooks, then a second plan is empty", async () => {
    const { ctx, io } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" } });
    gitFake(io, { checkout: false });
    const s1 = await claudeConfig.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: ["~/.claude absent — will clone"] });
    const steps = claudeConfig.plan(ctx, s1);
    expect(steps.map((s) => s.id)).toEqual(["claude-config.clone", "claude-config.settings", "claude-config.hooks"]);

    await claudeConfig.apply(ctx, [steps[0]]);
    expect(io.calls.find((c) => c.cmd === "git" && c.args[0] === "clone")?.args).toEqual(["clone", "--quiet", opts.sshUrl, "/h/.claude"]);
    // the clone "materialises" the tracked files
    for (const [p, s] of Object.entries(tracked())) io.files.set(p, s);
    await claudeConfig.apply(ctx, [steps[1]]);
    const settings = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(settings.model).toBe("fable");
    expect(io.files.has("/h/.claude/settings.json.bak.pre-settings-template")).toBe(false); // nothing to back up on a seed
    await claudeConfig.apply(ctx, [steps[2]]);
    const after = JSON.parse(io.files.get("/h/.claude/settings.json")!);
    expect(Object.keys(after.hooks).sort()).toEqual(["Notification", "PreToolUse", "SessionStart"]);

    expect(await claudeConfig.detect(ctx)).toEqual({ kind: "present" });
    expect(claudeConfig.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("existing non-checkout ~/.claude is adopted in place, never overwritten", async () => {
    const { ctx, io, events } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "local edits\n", ...tracked() } });
    gitFake(io, { checkout: false, porcelain: " M CLAUDE.md\n D skills/save/SKILL.md\n" });
    const s = await claudeConfig.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: ["~/.claude exists but is not a checkout — will adopt in place"] });
    const steps = claudeConfig.plan(ctx, s);
    expect(steps[0].id).toBe("claude-config.adopt");
    await claudeConfig.apply(ctx, [steps[0]]);
    const gitArgs = io.calls.filter((c) => c.cmd === "git").map((c) => c.args.slice(2).join(" "));
    expect(gitArgs).toContain("init -q -b main");
    expect(gitArgs).toContain(`remote add origin ${opts.sshUrl}`);
    expect(gitArgs).toContain("checkout -q -- skills/save/SKILL.md");  // restore the missing tracked file
    expect(gitArgs.some((a) => a.startsWith("checkout") && a.includes("CLAUDE.md"))).toBe(false); // never clobber the modified one
    expect(io.files.get("/h/.claude/CLAUDE.md")).toBe("local edits\n");
    expect(events.find((e) => e.type === "note" && /1 tracked file\(s\) .* differ/.test(e.message))).toBeTruthy();
  });

  it("checkout behind origin plans a pull; tracked modifications are reported, not fixed", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: {
      ...tracked(),
      "/h/.claude/settings.json": JSON.stringify({ ...JSON.parse(template), hooks: {} }),
    } });
    gitFake(io, { checkout: true, porcelain: " M CLAUDE.md\n", remoteHead: "ffffff" });
    const s = await claudeConfig.detect(ctx);
    expect(s.kind).toBe("drifted");
    expect((s as { details: string[] }).details).toEqual(expect.arrayContaining([
      expect.stringMatching(/behind origin/), expect.stringMatching(/1 tracked file\(s\) differ/), expect.stringMatching(/hooks block differs/),
    ]));
    expect(claudeConfig.plan(ctx, s).map((x) => x.id)).toEqual(["claude-config.pull", "claude-config.hooks"]);
  });

  it("hooks step backs up first and renders exec form on win32", async () => {
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home: "C:\\Users\\t", path: { node: "C:\\Program Files\\nodejs\\node.exe" }, files: {
      "C:\\Users\\t\\.claude\\scripts\\settings.template.json": template,
      "C:\\Users\\t\\.claude\\scripts\\canonical-hooks.json": canonical,
      "C:\\Users\\t\\.claude\\settings.json": JSON.stringify(JSON.parse(template)),
    } });
    await claudeConfig.apply(ctx, [{ id: "claude-config.hooks", title: "" }]);
    expect(io.files.has("C:\\Users\\t\\.claude\\settings.json.bak.pre-canonical-hooks")).toBe(true);
    const hooks = JSON.parse(io.files.get("C:\\Users\\t\\.claude\\settings.json")!).hooks;
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(hooks.PreToolUse[0].hooks[0].args[0]).toBe("C:\\Users\\t\\.claude\\scripts\\pretool-write-untracked-guard.mjs");
    expect(JSON.stringify(hooks)).not.toContain("cc-status");
  });

  it("verify mirrors the bootstrap doctor checks", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { ...tracked(), "/h/.claude/settings.json": "{not json" } });
    gitFake(io, { checkout: true });
    const checks = await claudeConfig.verify(ctx);
    expect(checks.map((c) => [c.id, c.status])).toEqual([["checkout", "ok"], ["clean", "ok"], ["settings-valid", "error"]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/claude-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/claude-config.ts`**

```ts
import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import { deepEqual, renderHooks, seedSettings, stableJson, type HooksBlock } from "../engine/settings.ts";

interface Opts { sshUrl: string; httpsUrl: string }
const ID = "claude-config";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });

const norm = (p: string, os: NodeJS.Platform | string) => {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return os === "win32" ? s.toLowerCase().replace(/^\/([a-z])\//, "$1:/") : s;
};

export async function isCheckout(io: Io, dir: string): Promise<boolean> {
  const r = await io.exec("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  return r.code === 0 && norm(r.stdout.trim(), io.platform) === norm(dir, io.platform);
}

/** SSH when a key is loaded, else HTTPS (bootstrap.sh clone_url: ssh -T exits 1 even on success). */
export async function cloneUrl(io: Io, ssh: string, https: string): Promise<string> {
  const r = await io.exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-T", "git@github.com"]);
  return /successfully authenticated/.test(r.stdout + r.stderr) ? ssh : https;
}

const git = (io: Io, dir: string, ...args: string[]) => io.exec("git", ["-C", dir, ...args]);

async function readJsonOrNull(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return "invalid"; }
}

interface Facts {
  exists: boolean; checkout: boolean; modified: string[]; deleted: string[]; behind: boolean;
  settings: Record<string, unknown> | null | "invalid"; templateAdded: string[]; templateStale: string[]; hooksDiffer: boolean;
}

async function renderedHooks(ctx: Ctx): Promise<HooksBlock | null> {
  const raw = await ctx.io.readFile(pj(ctx.env.os, ctx.env.claudeDir, "scripts", "canonical-hooks.json"));
  if (raw === null) return null;
  const canonical = (JSON.parse(raw) as { hooks: HooksBlock }).hooks;
  const nodeExe = ctx.env.os === "win32" ? (await ctx.io.which("node")) ?? undefined : undefined;
  return renderHooks(canonical, { platform: ctx.env.os, nodeExe, homeWin: ctx.env.os === "win32" ? ctx.env.home : undefined });
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx;
  const dir = env.claudeDir;
  const f: Facts = { exists: await io.isDir(dir), checkout: false, modified: [], deleted: [], behind: false, settings: null, templateAdded: [], templateStale: [], hooksDiffer: false };
  if (f.exists) {
    f.checkout = await isCheckout(io, dir);
    if (f.checkout) {
      const st = await git(io, dir, "status", "--porcelain");
      for (const line of st.stdout.split(/\r?\n/)) {
        if (!line) continue;
        const code = line.slice(0, 2), file = line.slice(3);
        if (code.includes("D")) f.deleted.push(file); else if (code.trim()) f.modified.push(file);
      }
      const head = (await git(io, dir, "rev-parse", "HEAD")).stdout.trim();
      const remote = await git(io, dir, "ls-remote", "origin", "refs/heads/main");
      if (remote.code === 0) f.behind = remote.stdout.split(/\s/)[0] !== head;
      else ctx.emit({ type: "note", level: "warn", message: "claude-config: origin unreachable — skipping the behind-origin check" });
    }
  }
  f.settings = await readJsonOrNull(io, pj(env.os, dir, "settings.json"));
  const tmplRaw = await io.readFile(pj(env.os, dir, "scripts", "settings.template.json"));
  if (tmplRaw !== null && f.settings !== "invalid") {
    const r = seedSettings(f.settings, JSON.parse(tmplRaw));
    f.templateAdded = r.added; f.templateStale = r.stale;
  }
  const hooks = await renderedHooks(ctx);
  if (hooks && f.settings !== "invalid") f.hooksDiffer = !deepEqual((f.settings ?? {}).hooks, hooks);
  return f;
}

export const claudeConfig: Artifact = {
  id: ID, surfaces: ["code"], portability: "portable", requires: ["prereqs"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.exists) return { kind: "absent", details: ["~/.claude absent — will clone"] };
    if (!f.checkout) return { kind: "absent", details: ["~/.claude exists but is not a checkout — will adopt in place"] };
    const details: string[] = [];
    if (f.behind) details.push("behind origin/main — will pull --ff-only");
    if (f.modified.length) details.push(`${f.modified.length} tracked file(s) differ from origin — NOT overwriting: ${f.modified.join(", ")}`);
    if (f.settings === "invalid") details.push("settings.json is not valid JSON");
    if (f.templateAdded.length || f.templateStale.length) details.push(`settings template drift — missing: [${f.templateAdded.join(", ")}] managed drift: [${f.templateStale.join(", ")}]`);
    if (f.hooksDiffer) details.push("hooks block differs from rendered canonical-hooks.json");
    return details.length ? { kind: "drifted", details } : { kind: "present" };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    const d = state.details ?? [];
    if (state.kind === "absent") steps.push(d[0]?.includes("adopt") ? step("adopt", "adopt existing ~/.claude as the dotclaude checkout") : step("clone", "clone dotclaude to ~/.claude"));
    if (d.some((x) => x.startsWith("behind origin"))) steps.push(step("pull", "git pull --ff-only in ~/.claude"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("settings template drift"))) steps.push(step("settings", "seed settings.json from settings.template.json (missing + managed keys only)"));
    if (state.kind === "absent" || d.some((x) => x.startsWith("hooks block differs"))) steps.push(step("hooks", "render canonical-hooks.json into settings.json for this platform"));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx; const dir = env.claudeDir; const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.clone`: {
          const r = await io.exec("git", ["clone", "--quiet", await cloneUrl(io, o.sshUrl, o.httpsUrl), dir]);
          if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim()}`);
          break;
        }
        case `${ID}.adopt`: {
          const url = await cloneUrl(io, o.sshUrl, o.httpsUrl);
          for (const a of [["init", "-q", "-b", "main"], ["remote", "add", "origin", url], ["fetch", "-q", "origin"]]) {
            const r = await git(io, dir, ...a); if (r.code !== 0) throw new Error(`git ${a[0]} failed: ${r.stderr.trim()}`);
          }
          const originMain = (await git(io, dir, "rev-parse", "origin/main")).stdout.trim();
          await git(io, dir, "update-ref", "refs/heads/main", originMain);
          await git(io, dir, "reset", "-q", "--mixed", "HEAD");
          await git(io, dir, "branch", "-q", "--set-upstream-to=origin/main", "main");
          const f = await facts(ctx);
          for (const file of f.deleted) await git(io, dir, "checkout", "-q", "--", file);
          if (f.deleted.length) ctx.emit({ type: "note", level: "info", message: `restored ${f.deleted.length} tracked file(s) missing from ~/.claude` });
          if (f.modified.length) ctx.emit({ type: "note", level: "warn", message: `${f.modified.length} tracked file(s) in ~/.claude differ from origin — NOT overwriting; reconcile via git -C ~/.claude status` });
          else ctx.emit({ type: "note", level: "info", message: "adopted: working tree matches origin/main" });
          break;
        }
        case `${ID}.pull`: {
          const r = await git(io, dir, "pull", "--ff-only", "--quiet");
          if (r.code !== 0) ctx.emit({ type: "note", level: "warn", message: "pull --ff-only failed — reconcile manually (git -C ~/.claude status)" });
          break;
        }
        case `${ID}.settings`: {
          const sp = pj(env.os, dir, "settings.json");
          const current = await readJsonOrNull(io, sp);
          if (current === "invalid") throw new Error("settings.json is not valid JSON — fix it by hand, then re-run");
          const tmpl = await io.readFile(pj(env.os, dir, "scripts", "settings.template.json"));
          if (tmpl === null) { ctx.emit({ type: "note", level: "warn", message: "no settings.template.json; nothing to seed" }); break; }
          const r = seedSettings(current, JSON.parse(tmpl));
          if (!r.added.length && !r.stale.length) break;
          if (current !== null) await io.copyFile(sp, sp + ".bak.pre-settings-template");
          await io.writeFile(sp, stableJson(r.next));
          JSON.parse((await io.readFile(sp))!); // round-trip validation, as the bash applier does
          break;
        }
        case `${ID}.hooks`: {
          const sp = pj(env.os, dir, "settings.json");
          const current = await readJsonOrNull(io, sp);
          if (current === null || current === "invalid") throw new Error("settings.json missing or invalid — the settings step must run first");
          const rendered = await renderedHooks(ctx);
          if (rendered === null) { ctx.emit({ type: "note", level: "warn", message: "no canonical-hooks.json; nothing to apply" }); break; }
          if (deepEqual(current.hooks, rendered)) break;
          await io.copyFile(sp, sp + ".bak.pre-canonical-hooks");
          await io.writeFile(sp, stableJson({ ...current, hooks: rendered }));
          JSON.parse((await io.readFile(sp))!);
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx);
    const out: Check[] = [];
    if (!f.exists || !f.checkout) { out.push({ id: "checkout", status: "error", message: "~/.claude is not a git checkout" }); return out; }
    out.push({ id: "checkout", status: "ok", message: "~/.claude is a git checkout" });
    const n = f.modified.length + f.deleted.length;
    out.push(n === 0 ? { id: "clean", status: "ok", message: "~/.claude clean vs origin" } : { id: "clean", status: "warn", message: `~/.claude has ${n} changed path(s) — git -C ~/.claude status` });
    if (f.settings === null || f.settings === "invalid") { out.push({ id: "settings-valid", status: "error", message: "settings.json missing or invalid" }); return out; }
    out.push({ id: "settings-valid", status: "ok", message: "settings.json is valid JSON" });
    out.push(f.hooksDiffer ? { id: "hooks-match", status: "error", message: "hooks block differs from canonical-hooks.json — run bs onboard" } : { id: "hooks-match", status: "ok", message: "hooks match canonical-hooks.json" });
    const drift = [...f.templateAdded, ...f.templateStale];
    out.push(drift.length ? { id: "template-keys", status: "error", message: `settings template drift: ${drift.join(", ")} — run bs onboard` } : { id: "template-keys", status: "ok", message: "settings.json carries every template key (managed keys in sync)" });
    return out;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/claude-config.test.ts`
Expected: 5 passed. If the adopt test's `checkout -q -- skills/save/SKILL.md` assertion fails, check that `facts()` is called *after* `reset --mixed` (the porcelain fake is static, but the real sequence matters).

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/claude-config.ts tests/unit/artifacts/claude-config.test.ts
git commit -m "feat(artifacts): claude-config — checkout adopt/clone/pull, settings seed, hooks render"
```

---

### Task 9: Artifact `secrets`

**Files:**
- Create: `src/artifacts/secrets.ts`
- Test: `tests/unit/artifacts/secrets.test.ts`

**Interfaces:**
- Consumes: `SecretService`, `SecretRef`, `defaultAccount` (Task 4); `Artifact`, `Step`, `Check` (Task 3).
- Options: `{ services: SecretService[] }` — which services this profile needs.
- Produces: `export const secrets: Artifact` (id `secrets`, surfaces both, `device-bound`, requires `["prereqs"]`); `export const SECRET_LABELS: Record<SecretService, string>`; `export const SECRET_SEVERITY: Record<SecretService, "error" | "warn">`.

Severity: `cornell-ai-gateway` → `error` (the wrapper fails closed without it); the others → `warn` (bootstrap.sh's own severity for the MeCP key; mct/MeCP tools degrade rather than refuse).

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/secrets.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { secrets } from "../../../src/artifacts/secrets.ts";
import { makeCtx } from "../helpers.ts";

const opts = { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key"] };

describe("secrets", () => {
  it("is absent with one interactive step per missing secret, naming the location not the value", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.config/mecp/api_key": "k\n" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    const s = await secrets.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [
      "cornell-ai-gateway missing — login Keychain item service=cornell-ai-gateway account=aca34",
      "mecp-device-token missing — login Keychain item service=mecp-device-token account=aca34",
    ] });
    const steps = secrets.plan(ctx, s);
    expect(steps).toEqual([
      { id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } },
      { id: "secrets.mecp-device-token", title: "Paste the MeCP device token (mint it on a box with admin access: mecp/scripts/mint-device-token.ts --scope write)", interactive: true, secret: { service: "mecp-device-token", account: "aca34" } },
    ]);
  });

  it("apply prompts, stores via stdin, and never puts the value in events or argv", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { USER: "aca34" }, interactive: true, answers: { "Paste the Cornell AI gateway key": "sk-live-XYZ" } });
    io.on((c) => c === "security", () => ({ code: 0, stdout: "", stderr: "" }));
    await secrets.apply(ctx, [{ id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } }]);
    const set = io.calls.find((c) => c.cmd === "security" && c.args[0] === "-i");
    expect(set?.opts.stdin).toContain("sk-live-XYZ");
    expect(JSON.stringify(io.calls.map((c) => c.args))).not.toContain("sk-live-XYZ");
    expect(JSON.stringify(events)).not.toContain("sk-live-XYZ");
  });

  it("apply with a blank answer skips with a warning instead of writing", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { USER: "aca34" }, interactive: true, answers: {} });
    await secrets.apply(ctx, [{ id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } }]);
    expect(io.calls).toHaveLength(0);
    expect(events).toContainEqual({ type: "note", level: "warn", message: "secrets: cornell-ai-gateway skipped (blank)" });
  });

  it("verify: gateway missing is an error, the others warn, present ones are ok", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.config/mecp/api_key": "k\n" } });
    io.on((c, a) => c === "security" && a.includes("mecp-device-token"), () => ({ code: 0, stdout: "tok\n", stderr: "" }));
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    expect((await secrets.verify(ctx)).map((c) => [c.id, c.status])).toEqual([
      ["cornell-ai-gateway", "error"], ["mecp-device-token", "ok"], ["mecp-api-key", "ok"],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/secrets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/secrets.ts`**

```ts
import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { defaultAccount, type SecretRef, type SecretService } from "../engine/secrets/store.ts";

export const SECRET_LABELS: Record<SecretService, string> = {
  "cornell-ai-gateway": "Paste the Cornell AI gateway key",
  "mecp-device-token": "Paste the MeCP device token (mint it on a box with admin access: mecp/scripts/mint-device-token.ts --scope write)",
  "mecp-api-key": "Paste the MeCP API key used by the SessionStart context hook",
  "mct-sync-token": "Paste the mct sync token (from `mct devices add` on an admin box)",
};
export const SECRET_SEVERITY: Record<SecretService, "error" | "warn"> = {
  "cornell-ai-gateway": "error", "mecp-device-token": "warn", "mecp-api-key": "warn", "mct-sync-token": "warn",
};

const ID = "secrets";
const refs = (ctx: Ctx): SecretRef[] => {
  const services = ((ctx.opts as { services?: SecretService[] }).services ?? []);
  const account = defaultAccount(ctx.io);
  return services.map((service) => ({ service, account }));
};

async function missing(ctx: Ctx): Promise<SecretRef[]> {
  const out: SecretRef[] = [];
  for (const ref of refs(ctx)) if ((await ctx.secrets.get(ref)) === null) out.push(ref);
  return out;
}

export const secrets: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "device-bound", requires: ["prereqs"],

  async detect(ctx): Promise<State> {
    const m = await missing(ctx);
    return m.length ? { kind: "absent", details: m.map((r) => `${r.service} missing — ${ctx.secrets.describe(r)}`) } : { kind: "present" };
  },

  plan(ctx, state): Step[] {
    if (state.kind !== "absent") return [];
    const account = defaultAccount(ctx.io);
    return (state.details ?? []).map((d) => d.split(" missing — ")[0] as SecretService).map((service) => ({
      id: `${ID}.${service}`, title: SECRET_LABELS[service], interactive: true, secret: { service, account },
    }));
  },

  async apply(ctx, steps) {
    for (const s of steps) {
      if (!s.secret) throw new Error(`step ${s.id} carries no SecretRef`);
      const value = (await ctx.prompt.secret(s.title)).trim();
      if (!value) { ctx.emit({ type: "note", level: "warn", message: `secrets: ${s.secret.service} skipped (blank)` }); continue; }
      await ctx.secrets.set(s.secret, value);
      ctx.emit({ type: "note", level: "info", message: `secrets: stored ${s.secret.service} → ${ctx.secrets.describe(s.secret)}` });
    }
  },

  async verify(ctx): Promise<Check[]> {
    const out: Check[] = [];
    for (const ref of refs(ctx)) {
      const present = (await ctx.secrets.get(ref)) !== null;
      out.push(present
        ? { id: ref.service, status: "ok", message: `${ref.service} present (${ctx.secrets.describe(ref)})` }
        : { id: ref.service, status: SECRET_SEVERITY[ref.service], message: `${ref.service} missing — bs secrets set ${ref.service}  (${ctx.secrets.describe(ref)})` });
    }
    return out;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/secrets.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/secrets.ts tests/unit/artifacts/secrets.test.ts
git commit -m "feat(artifacts): secrets — prompt-once into the OS store, values never leave stdin"
```

---

### Task 10: Artifact `gateway-launch` (generated wrappers, mac + Windows)

**Files:**
- Create: `src/artifacts/gateway-launch.ts`, `src/artifacts/templates/claude-gw.zsh.ts`, `src/artifacts/templates/claude-gw.ps1.ts`
- Test: `tests/unit/artifacts/gateway-launch.test.ts`

**Interfaces:**
- Consumes: `Artifact`, `Step`, `Check` (Task 3); `SecretStore` via ctx (Task 4).
- Options: `{ baseUrl: string; mcpBundle?: string }` — `mcpBundle` defaults to `<claudeDir>/mcp/gateway.json`.
- Produces: `export const gatewayLaunch: Artifact` (id `gateway-launch`, surfaces `["code"]`, `translatable`, requires `["claude-config","secrets"]`); `renderZsh({ baseUrl, mcpBundle, home })`, `renderPs1({ baseUrl, mcpBundle, home })`, `renderCmd()`; `export const MARKER = "# boot-slapper:claude-gw"`.

Ownership rule: files under `~/.config/boot-slapper/` are generated and **regenerated** when they differ (they are ours). Shell rc files (`~/.zshrc`, `$PROFILE`) get exactly one marker line **appended**, never edited. A legacy `source …/dotfiles/zsh/claude-gw.zsh` line is reported by `verify` as a warning (two definitions) — removal is gate 2 (spec §6).

Paths:
| OS | wrapper | rc file | rc line |
|---|---|---|---|
| darwin | `~/.config/boot-slapper/claude-gw.zsh` | `~/.zshrc` | `[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  # boot-slapper:claude-gw` |
| win32 | `~/.config/boot-slapper/claude-gw.ps1` + `~/.local/bin/claude-gw.cmd` | `$PROFILE` (from `powershell -NoProfile -Command $PROFILE`) | `. "$env:USERPROFILE\.config\boot-slapper\claude-gw.ps1"  # boot-slapper:claude-gw` |

- [ ] **Step 1: Write the templates**

`src/artifacts/templates/claude-gw.zsh.ts`:
```ts
const homeRel = (p: string, home: string) => (p.startsWith(home) ? "$HOME" + p.slice(home.length) : p);

export const renderZsh = (o: { baseUrl: string; mcpBundle: string; home: string }) => `# claude-gw — generated by boot-slapper; edits are overwritten on \`bs onboard\`.
# Claude Code against the gateway at ${o.baseUrl}, with the launch-scoped MCP bundle.
# Secrets come from the login Keychain (bs secrets set <service>); nothing sensitive sits in a file.
# Open Brain carries no token: Claude Code runs its OAuth flow once via /mcp -> openbrain.
# Deliberately NOT --strict-mcp-config: project .mcp.json servers must survive.

claude-gw() {
  local gw_token mecp_token
  gw_token=$(security find-generic-password -w -s cornell-ai-gateway -a "$USER" 2>/dev/null)
  if [[ -z "$gw_token" ]]; then
    print -u2 "claude-gw: no gateway token in Keychain (service 'cornell-ai-gateway'). Run: bs secrets set cornell-ai-gateway"
    return 1
  fi
  mecp_token=$(security find-generic-password -w -s mecp-device-token -a "$USER" 2>/dev/null)
  if [[ -z "$mecp_token" ]]; then
    print -u2 "claude-gw: no MeCP device token in Keychain — mecp tools will 401. Run: bs secrets set mecp-device-token"
  fi
  # No ANTHROPIC_MODEL pin: let the gateway serve its default; pass --model explicitly when needed.
  ANTHROPIC_BASE_URL="${o.baseUrl}" \\
  ANTHROPIC_AUTH_TOKEN="$gw_token" \\
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 \\
  DISABLE_TELEMETRY=1 \\
  MECP_DEVICE_TOKEN="$mecp_token" \\
  command claude --mcp-config "${homeRel(o.mcpBundle, o.home)}" "$@"
}
`;
```

`src/artifacts/templates/claude-gw.ps1.ts`:
```ts
const homeRel = (p: string, home: string) => (p.toLowerCase().startsWith(home.toLowerCase()) ? "$env:USERPROFILE" + p.slice(home.length) : p);

export const renderPs1 = (o: { baseUrl: string; mcpBundle: string; home: string }) => `# claude-gw — generated by boot-slapper; edits are overwritten on \`bs onboard\`.
# Claude Code against the gateway at ${o.baseUrl}. Secrets come from Windows Credential Manager (bs secrets set <service>).
function claude-gw {
  [void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
  $v = New-Object Windows.Security.Credentials.PasswordVault
  $acct = $env:USERNAME
  try { $c = $v.Retrieve('cornell-ai-gateway', $acct); $c.RetrievePassword(); $gw = $c.Password }
  catch { Write-Error "claude-gw: no gateway token in Credential Manager (resource 'cornell-ai-gateway'). Run: bs secrets set cornell-ai-gateway"; return }
  $mecp = ''
  try { $c = $v.Retrieve('mecp-device-token', $acct); $c.RetrievePassword(); $mecp = $c.Password }
  catch { Write-Warning "claude-gw: no MeCP device token — mecp tools will 401. Run: bs secrets set mecp-device-token" }
  $env:ANTHROPIC_BASE_URL = '${o.baseUrl}'
  $env:ANTHROPIC_AUTH_TOKEN = $gw
  $env:CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
  $env:DISABLE_TELEMETRY = '1'
  $env:MECP_DEVICE_TOKEN = $mecp
  try { & claude --mcp-config "${homeRel(o.mcpBundle, o.home)}" @args }
  finally { Remove-Item Env:ANTHROPIC_BASE_URL, Env:ANTHROPIC_AUTH_TOKEN, Env:MECP_DEVICE_TOKEN, Env:CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, Env:DISABLE_TELEMETRY -ErrorAction SilentlyContinue }
}
`;

/** cmd shim so \`claude-gw\` also works from Git Bash / cmd. Plain args only; quote-heavy args should go through PowerShell directly. */
export const renderCmd = () => `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command ". '%USERPROFILE%\\.config\\boot-slapper\\claude-gw.ps1'; claude-gw %*"\r\n`;
```

- [ ] **Step 2: Write the failing test**

`tests/unit/artifacts/gateway-launch.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { gatewayLaunch, MARKER } from "../../../src/artifacts/gateway-launch.ts";
import { makeCtx } from "../helpers.ts";

const opts = { baseUrl: "https://api.ai.it.cornell.edu" };
const bundle = JSON.stringify({ mcpServers: { openbrain: { type: "http", url: "https://ob/mcp" }, mecp: { type: "http", url: "https://mecp/mcp", headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" } } } });

describe("gateway-launch (darwin)", () => {
  it("absent on a fresh box: writes the wrapper and appends one marker line to ~/.zshrc", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.claude/mcp/gateway.json": bundle, "/h/.zshrc": "export FOO=1\n" } });
    io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    expect(s.kind).toBe("absent");
    const steps = gatewayLaunch.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["gateway-launch.wrapper", "gateway-launch.shell-rc"]);
    await gatewayLaunch.apply(ctx, steps);
    const wrapper = io.files.get("/h/.config/boot-slapper/claude-gw.zsh")!;
    expect(wrapper).toContain('ANTHROPIC_BASE_URL="https://api.ai.it.cornell.edu"');
    expect(wrapper).toContain('--mcp-config "$HOME/.claude/mcp/gateway.json"');
    expect(wrapper).not.toContain("tok");
    expect(io.files.get("/h/.zshrc")).toBe(`export FOO=1\n[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  ${MARKER}\n`);
    expect(await gatewayLaunch.detect(ctx)).toEqual({ kind: "present" });
    await gatewayLaunch.apply(ctx, gatewayLaunch.plan(ctx, { kind: "present" }));
    expect(io.files.get("/h/.zshrc")!.split(MARKER).length).toBe(2); // still exactly one marker line
  });

  it("a hand-edited wrapper is regenerated (we own it); the rc line is never edited", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: {
      "/h/.claude/mcp/gateway.json": bundle,
      "/h/.config/boot-slapper/claude-gw.zsh": "# stale\n",
      "/h/.zshrc": `source ~/projects/dotfiles/zsh/claude-gw.zsh\n[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  ${MARKER}\n`,
    } });
    io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["wrapper differs from the generated version — will regenerate"] });
    expect(gatewayLaunch.plan(ctx, s).map((x) => x.id)).toEqual(["gateway-launch.wrapper"]);
    const checks = await gatewayLaunch.verify(ctx);
    expect(checks.find((c) => c.id === "legacy-wrapper")).toMatchObject({ status: "warn", message: expect.stringMatching(/dotfiles\/zsh\/claude-gw\.zsh/) });
  });

  it("verify: missing bundle or gateway secret are errors", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    const ids = Object.fromEntries((await gatewayLaunch.verify(ctx)).map((c) => [c.id, c.status]));
    expect(ids).toMatchObject({ wrapper: "error", "shell-rc": "error", "mcp-bundle": "error", "gateway-secret": "error" });
  });
});

describe("gateway-launch (win32)", () => {
  it("writes the ps1 + cmd shim and appends to $PROFILE", async () => {
    const home = "C:\\Users\\t";
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", PATH: `${home}\\.local\\bin;C:\\Windows` }, files: { [`${home}\\.claude\\mcp\\gateway.json`]: bundle } });
    io.on((c, a) => c === "powershell" && a.includes("$PROFILE"), () => ({ code: 0, stdout: `${home}\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1\r\n`, stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    const steps = gatewayLaunch.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["gateway-launch.wrapper", "gateway-launch.cmd-shim", "gateway-launch.shell-rc"]);
    await gatewayLaunch.apply(ctx, steps);
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw.ps1`)).toContain("$env:ANTHROPIC_BASE_URL = 'https://api.ai.it.cornell.edu'");
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw.ps1`)).toContain('--mcp-config "$env:USERPROFILE\\.claude\\mcp\\gateway.json"');
    expect(io.files.get(`${home}\\.local\\bin\\claude-gw.cmd`)).toMatch(/^@echo off\r\n/);
    expect(io.files.get(`${home}\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1`)).toBe(`. "$env:USERPROFILE\\.config\\boot-slapper\\claude-gw.ps1"  ${MARKER}\n`);
    expect((await gatewayLaunch.verify(ctx)).find((c) => c.id === "path")).toMatchObject({ status: "ok" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/gateway-launch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/artifacts/gateway-launch.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/gateway-launch.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Diff the generated zsh wrapper against the live one**

Run:
```bash
npx tsx -e '
import { renderZsh } from "./src/artifacts/templates/claude-gw.zsh.ts";
process.stdout.write(renderZsh({ baseUrl: "https://api.ai.it.cornell.edu", mcpBundle: process.env.HOME + "/.claude/mcp/gateway.json", home: process.env.HOME }));
' > /tmp/bs-claude-gw.zsh
diff <(grep -v '^#' ~/projects/dotfiles/zsh/claude-gw.zsh | grep -v '^\s*$') <(grep -v '^#' /tmp/bs-claude-gw.zsh | grep -v '^\s*$'); zsh -n /tmp/bs-claude-gw.zsh && echo "zsh syntax ok"
```
Expected: the only diffs are the two `Run: bs secrets set …` hint suffixes on the error/warn lines; `zsh syntax ok`.

- [ ] **Step 7: Commit**

```bash
git add src/artifacts/gateway-launch.ts src/artifacts/templates tests/unit/artifacts/gateway-launch.test.ts
git commit -m "feat(artifacts): gateway-launch — generated claude-gw wrappers for zsh and PowerShell"
```

---

### Task 11: Profile `aca34`, tty prompter, headless UI, run log, and the `bs` CLI

**Files:**
- Create: `src/profiles/aca34.ts`, `src/ui/prompt.ts`, `src/ui/headless.ts`, `src/cli.ts`
- Test: `tests/unit/ui/headless.test.ts`, `tests/unit/cli.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  // profiles/aca34.ts
  export const aca34: Profile
  // ui/prompt.ts
  export function ttyPrompter(): Prompter          // hidden input via readline on /dev/tty-equivalent (process.stdin must be a TTY)
  export function headlessPrompter(): Prompter     // every method throws InteractiveRequired
  // ui/headless.ts
  export interface Sink { write(line: string): void }
  export function headlessReporter(sink: Sink): (e: EngineEvent) => void   // ==> / ✓ / ! / ✗ lines, bootstrap.sh style
  export function runLogWriter(io: Io, dir: string, startedAt: Date): { emit(e: EngineEvent): void; path: string }  // JSONL, one event per line
  export function renderPlanText(plan: Plan): string
  export function renderChecksText(checks: Record<string, Check[]>): string
  // cli.ts
  export async function main(argv: string[], deps?: { io?: Io; stdout?: Sink; stderr?: Sink; interactive?: boolean }): Promise<number>
  ```

Commands (spec §2): `bs env`, `bs plan [--profile] [--only] [--skip]`, `bs doctor [--profile] [--json]`, `bs onboard [--profile] [--auto] [--only] [--skip]`, `bs secrets set|check <service>`. `--profile` defaults to `aca34`. `onboard` without `--auto` on a non-TTY behaves as `--auto`.

Profile (Phase 1 subset — Phase 2 appends `project-memory`, `mct`, `plugins`):
```ts
import { claudeConfig } from "../artifacts/claude-config.ts";
import { gatewayLaunch } from "../artifacts/gateway-launch.ts";
import { prereqs } from "../artifacts/prereqs.ts";
import { secrets } from "../artifacts/secrets.ts";
import type { Profile } from "../engine/profile.ts";

export const aca34: Profile = {
  name: "aca34",
  provider: "gateway",
  surfaces: ["code"],                       // "desktop" joins in Phase 3
  artifacts: [prereqs, claudeConfig, secrets, gatewayLaunch],
  options: {
    "claude-config": { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" },
    secrets: { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key"] },
    "gateway-launch": { baseUrl: "https://api.ai.it.cornell.edu" },
  },
};
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/ui/headless.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { headlessReporter, renderChecksText, runLogWriter } from "../../../src/ui/headless.ts";
import { FakeIo } from "../../../src/engine/io.ts";

describe("headlessReporter", () => {
  it("renders events in bootstrap.sh style", () => {
    const lines: string[] = [];
    const report = headlessReporter({ write: (l) => lines.push(l) });
    report({ type: "artifact:detected", id: "claude-config", state: { kind: "drifted", details: ["behind origin"] } });
    report({ type: "step:start", artifact: "claude-config", step: { id: "claude-config.pull", title: "git pull --ff-only" } });
    report({ type: "step:done", artifact: "claude-config", step: { id: "claude-config.pull", title: "git pull --ff-only" }, ok: true });
    report({ type: "step:done", artifact: "x", step: { id: "x.1", title: "boom" }, ok: false, error: "exit 1" });
    report({ type: "check:result", artifact: "prereqs", check: { id: "git", status: "ok", message: "prereq: git" } });
    report({ type: "check:result", artifact: "prereqs", check: { id: "claude", status: "warn", message: "claude not found" } });
    report({ type: "artifact:skipped", id: "gateway-launch", reason: 'requires "secrets" which failed' });
    expect(lines).toEqual([
      "==> claude-config: drifted — behind origin",
      "    … git pull --ff-only",
      "    ✓ git pull --ff-only",
      "    ✗ boom — exit 1",
      "    ✓ prereq: git",
      "    ! claude not found",
      '==> gateway-launch: skipped — requires "secrets" which failed',
    ]);
  });
});

describe("runLogWriter", () => {
  it("appends one JSON line per event under <dir>/<timestamp>.jsonl", async () => {
    const io = new FakeIo();
    const w = runLogWriter(io, "/h/.config/boot-slapper/runs", new Date("2026-09-10T01:02:03Z"));
    w.emit({ type: "note", level: "info", message: "hi" });
    w.emit({ type: "artifact:detected", id: "a", state: { kind: "present" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(w.path).toBe("/h/.config/boot-slapper/runs/2026-09-10T01-02-03Z.jsonl");
    const lines = io.files.get(w.path)!.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "note", message: "hi" });
    expect(lines[1]).toMatchObject({ type: "artifact:detected", id: "a" });
    expect(lines.every((l) => typeof l.ts === "string")).toBe(true);
  });
});

describe("renderChecksText", () => {
  it("groups by artifact and ends with the summary line", () => {
    const txt = renderChecksText({ prereqs: [{ id: "git", status: "ok", message: "prereq: git" }], secrets: [{ id: "x", status: "error", message: "missing" }] });
    expect(txt).toBe("==> prereqs\n    ✓ prereq: git\n==> secrets\n    ✗ missing\n==> Doctor: 1 check(s) FAILED\n");
  });
});
```

`tests/unit/cli.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { FakeIo } from "../../src/engine/io.ts";

const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };

describe("bs cli", () => {
  it("env prints the probe as JSON", async () => {
    const out = sink();
    const code = await main(["env"], { io: new FakeIo({ hostname: "BOX", env: { ANTHROPIC_BASE_URL: "https://gw" } }), stdout: out, stderr: sink() });
    expect(code).toBe(0);
    expect(JSON.parse(out.lines.join("\n"))).toMatchObject({ label: "BOX", detectedProvider: "gateway", os: "darwin" });
  });
  it("doctor --json emits checks per artifact and exits 1 on any error", async () => {
    const out = sink();
    const io = new FakeIo();               // nothing installed → prereqs error
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    const code = await main(["doctor", "--json"], { io, stdout: out, stderr: sink() });
    expect(code).toBe(1);
    const j = JSON.parse(out.lines.join("\n"));
    expect(j.profile).toBe("aca34");
    expect(j.status).toBe("error");
    expect(j.checks.prereqs.find((c: { id: string }) => c.id === "git").status).toBe("error");
  });
  it("plan prints the plan without applying anything", async () => {
    const out = sink();
    const io = new FakeIo();
    io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));
    const code = await main(["plan"], { io, stdout: out, stderr: sink() });
    expect(code).toBe(0);
    expect(io.writes).toEqual([]);
    expect(out.lines.join("\n")).toMatch(/prereqs \[device-bound\]: blocked/);
  });
  it("rejects an unknown command with usage on stderr", async () => {
    const err = sink();
    expect(await main(["frobnicate"], { io: new FakeIo(), stdout: sink(), stderr: err })).toBe(2);
    expect(err.lines.join("\n")).toMatch(/usage/i);
  });
  it("secrets check reports the location, exit 1 when missing", async () => {
    const out = sink();
    const io = new FakeIo({ env: { USER: "aca34" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    expect(await main(["secrets", "check", "cornell-ai-gateway"], { io, stdout: out, stderr: sink() })).toBe(1);
    expect(out.lines[0]).toBe("cornell-ai-gateway: missing (login Keychain item service=cornell-ai-gateway account=aca34)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ui tests/unit/cli.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/ui/prompt.ts`**

```ts
import { createInterface } from "node:readline";
import { InteractiveRequired, type Prompter } from "../engine/artifact.ts";

export function headlessPrompter(): Prompter {
  return {
    secret: async (l) => { throw new InteractiveRequired(l); },
    confirm: async (l) => { throw new InteractiveRequired(l); },
    gate: async (l) => { throw new InteractiveRequired(l); },
  };
}

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    if (hidden) {
      // Mute the echo while the answer is typed; readline still receives the keystrokes.
      const orig = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes("\n")) orig.call(rl, "\n"); };
      out.write(question);
    }
    rl.question(hidden ? "" : question, (answer) => { rl.close(); resolve(answer); });
  });
}

export function ttyPrompter(): Prompter {
  return {
    secret: (label) => ask(`    ${label} (blank to skip): `, true),
    confirm: async (label) => /^y(es)?$/i.test((await ask(`    ${label} [y/N] `, false)).trim()),
    gate: async (label) => { await ask(`    ${label} — press Enter when done `, false); },
  };
}
```

- [ ] **Step 4: Implement `src/ui/headless.ts`**

```ts
import path from "node:path";
import type { Check } from "../engine/artifact.ts";
import type { EngineEvent } from "../engine/events.ts";
import type { Io } from "../engine/io.ts";
import type { Plan } from "../engine/plan.ts";

export interface Sink { write(line: string): void }
const ICON = { ok: "✓", warn: "!", error: "✗" } as const;

export function headlessReporter(sink: Sink): (e: EngineEvent) => void {
  return (e) => {
    switch (e.type) {
      case "artifact:detected": sink.write(`==> ${e.id}: ${e.state.kind}${"details" in e.state && e.state.details?.length ? " — " + e.state.details.join("; ") : e.state.kind === "blocked" ? " — " + e.state.reason : ""}`); break;
      case "artifact:skipped": sink.write(`==> ${e.id}: skipped — ${e.reason}`); break;
      case "step:start": sink.write(`    … ${e.step.title}`); break;
      case "step:done": sink.write(e.ok ? `    ✓ ${e.step.title}` : `    ✗ ${e.step.title} — ${e.error ?? "failed"}`); break;
      case "prompt:needed": sink.write(`    ? ${e.step.title}`); break;
      case "check:result": sink.write(`    ${ICON[e.check.status]} ${e.check.message}`); break;
      case "note": sink.write(`    ${e.level === "info" ? "·" : ICON[e.level]} ${e.message}`); break;
    }
  };
}

export function runLogWriter(io: Io, dir: string, startedAt: Date) {
  const stamp = startedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  const file = path.join(dir, `${stamp}.jsonl`);
  let chain: Promise<void> = io.mkdirp(dir, { mode: 0o700 });
  return {
    path: file,
    emit(e: EngineEvent) {
      chain = chain.then(async () => {
        const prev = (await io.readFile(file)) ?? "";
        await io.writeFile(file, prev + JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n", { mode: 0o600 });
      });
    },
    done: () => chain,
  };
}

export function renderPlanText(plan: Plan): string {
  const lines: string[] = [];
  for (const p of plan) {
    const d = "details" in p.state && p.state.details?.length ? " — " + p.state.details.join("; ") : p.state.kind === "blocked" ? " — " + p.state.reason : "";
    lines.push(`==> ${p.artifact.id} [${p.artifact.portability}]: ${p.state.kind}${d}`);
    for (const s of p.steps) lines.push(`    → ${s.title}${s.interactive ? " (interactive)" : ""}`);
  }
  return lines.join("\n") + "\n";
}

export function renderChecksText(checks: Record<string, Check[]>): string {
  const lines: string[] = [];
  let failures = 0;
  for (const [id, cs] of Object.entries(checks)) {
    lines.push(`==> ${id}`);
    for (const c of cs) { lines.push(`    ${ICON[c.status]} ${c.message}`); if (c.status === "error") failures++; }
  }
  lines.push(failures ? `==> Doctor: ${failures} check(s) FAILED` : "==> Doctor: all checks passed");
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 5: Implement `src/profiles/aca34.ts` (as listed above) and `src/cli.ts`**

`src/cli.ts`:
```ts
#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import type { Ctx } from "./engine/artifact.ts";
import { probeEnv, resolveEnv } from "./engine/env.ts";
import type { EngineEvent } from "./engine/events.ts";
import { RealIo, type Io } from "./engine/io.ts";
import type { Profile } from "./engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "./engine/run.ts";
import { defaultAccount, selectStore, type SecretService } from "./engine/secrets/store.ts";
import { aca34 } from "./profiles/aca34.ts";
import { headlessReporter, renderChecksText, renderPlanText, runLogWriter, type Sink } from "./ui/headless.ts";
import { headlessPrompter, ttyPrompter } from "./ui/prompt.ts";

const PROFILES: Record<string, Profile> = { aca34 };
const SERVICES: SecretService[] = ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"];

const USAGE = `bs — boot-slapper
  bs env
  bs plan    [--profile aca34] [--only a,b] [--skip a,b]
  bs doctor  [--profile aca34] [--json]
  bs onboard [--profile aca34] [--auto] [--only a,b] [--skip a,b]
  bs secrets set|check <${SERVICES.join("|")}>`;

interface Deps { io?: Io; stdout?: Sink; stderr?: Sink; interactive?: boolean }

async function buildCtx(io: Io, profile: Profile, interactive: boolean, emit: (e: EngineEvent) => void): Promise<Ctx> {
  const env = resolveEnv(await probeEnv(io), profile.provider, profile.surfaces[0]);
  return { env, io, secrets: selectStore(env, io), prompt: interactive ? ttyPrompter() : headlessPrompter(), interactive, opts: profile.options, emit };
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const io = deps.io ?? new RealIo();
  const stdout = deps.stdout ?? { write: (l: string) => process.stdout.write(l + "\n") };
  const stderr = deps.stderr ?? { write: (l: string) => process.stderr.write(l + "\n") };
  const [cmd, ...rest] = argv;
  let values: Record<string, string | boolean | undefined>, positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      profile: { type: "string", default: "aca34" }, json: { type: "boolean" }, auto: { type: "boolean" },
      only: { type: "string" }, skip: { type: "string" },
    } }));
  } catch (e) { stderr.write(String(e instanceof Error ? e.message : e)); stderr.write(USAGE); return 2; }

  const profile = PROFILES[String(values.profile)];
  if (!profile && cmd !== "env") { stderr.write(`unknown profile: ${String(values.profile)}`); return 2; }
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : undefined);
  const filter = { only: list(values.only), skip: list(values.skip) };
  const interactive = deps.interactive ?? (!values.auto && Boolean(process.stdin.isTTY));

  switch (cmd) {
    case "env": { stdout.write(JSON.stringify(await probeEnv(io), null, 2)); return 0; }
    case "plan": {
      const ctx = await buildCtx(io, profile, false, () => {});
      stdout.write(renderPlanText(await resolvePlan(profile, ctx, filter)).trimEnd());
      return 0;
    }
    case "doctor": {
      const ctx = await buildCtx(io, profile, false, () => {});
      const checks = await verifyAll(profile, ctx);
      const status = worstStatus(checks);
      if (values.json) stdout.write(JSON.stringify({ profile: profile.name, env: ctx.env, status, checks }, null, 2));
      else stdout.write(renderChecksText(checks).trimEnd());
      return status === "error" ? 1 : 0;
    }
    case "onboard": {
      const startedAt = new Date();
      const home = io.home;
      const log = runLogWriter(io, path.join(home, ".config", "boot-slapper", "runs"), startedAt);
      const report = headlessReporter(stdout);
      const ctx = await buildCtx(io, profile, interactive, (e) => { report(e); log.emit(e); });
      stdout.write(`==> boot-slapper onboard — profile ${profile.name} on ${ctx.env.label} (${ctx.env.os}, ${ctx.env.provider}${interactive ? "" : ", --auto"})`);
      const plan = await resolvePlan(profile, ctx, filter);
      stdout.write(renderPlanText(plan).trimEnd());
      if (interactive && !(await ctx.prompt.confirm("Apply this plan?"))) { stdout.write("aborted"); await log.done(); return 3; }
      const res = await applyPlan(plan, ctx);
      stdout.write(renderChecksText(res.checks).trimEnd());
      stdout.write(`==> run log: ${log.path}`);
      await log.done();
      return res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
    }
    case "secrets": {
      const [op, svc] = positionals;
      if (!["set", "check"].includes(op) || !SERVICES.includes(svc as SecretService)) { stderr.write(USAGE); return 2; }
      const ctx = await buildCtx(io, profile ?? aca34, interactive, () => {});
      const ref = { service: svc as SecretService, account: defaultAccount(io) };
      if (op === "check") {
        const present = (await ctx.secrets.get(ref)) !== null;
        stdout.write(`${svc}: ${present ? "present" : "missing"} (${ctx.secrets.describe(ref)})`);
        return present ? 0 : 1;
      }
      const value = (await ctx.prompt.secret(`Paste ${svc}`)).trim();
      if (!value) { stderr.write("blank — nothing stored"); return 1; }
      await ctx.secrets.set(ref, value);
      stdout.write(`${svc}: stored (${ctx.secrets.describe(ref)})`);
      return 0;
    }
    default: stderr.write(USAGE); return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/dist/cli.js") || process.argv[1]?.endsWith("\\dist\\cli.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ui tests/unit/cli.test.ts`
Expected: 8 passed. Then `npm run typecheck` — expected: no errors.

- [ ] **Step 7: Live headless run on this mac (read-only commands only)**

Run:
```bash
npm run build && node dist/cli.js env && node dist/cli.js plan && node dist/cli.js doctor; echo "doctor exit: $?"
```
Expected: `env` shows `label: JCB-AL-ACA34`, `detectedProvider: "subscription"` (this session is claude.ai-authenticated); `plan` shows `prereqs: present`, `claude-config: present` (or `drifted` naming exactly what `git -C ~/.claude status` shows), `secrets: present` (both Keychain items exist on this box; `~/.config/mecp/api_key` present), `gateway-launch: absent — wrapper absent — will write; no # boot-slapper:claude-gw line in /Users/aca34/.zshrc — will append`. Doctor exit is 1 solely because of `gateway-launch` (wrapper/shell-rc). **Do not run `onboard` on this mac in Phase 1** — the wrapper cutover is gate 2.

- [ ] **Step 8: Commit**

```bash
git add src/profiles/aca34.ts src/ui src/cli.ts tests/unit/ui tests/unit/cli.test.ts
git commit -m "feat(cli): bs env/plan/doctor/onboard/secrets with headless reporter and run log"
```

---

### Task 12: Doctor parity gate against `bootstrap.sh --doctor`

**Files:**
- Create: `tests/parity/doctor-parity.test.ts`, `tests/parity/normalize.ts`
- Test: itself (`npm run test:parity`)

**Interfaces:**
- Produces: `export function parseBashDoctor(text: string): Record<string, "ok" | "warn" | "error">` — maps the bash doctor's lines to the check ids the `bs` artifacts use; `export const PARITY_MAP: Array<{ id: string; artifact: string; bashPattern: RegExp }>`.

Only the checks both implement in Phase 1 are compared (memory-sync and mct rows arrive with Phase 2):

| bs `artifact.id` | bash line pattern |
|---|---|
| `prereqs.git` / `.curl` / `.jq` | `prereq: git` / `prereq missing: git` … |
| `prereqs.python` | `prereq: python` / `prereq missing: python3/python` |
| `prereqs.node`, `prereqs.claude` | `prereq: node` / `prereq missing (install manually): node` … (bash marks node warn-only; the parity test maps bash `warn`→`ok-or-warn` for node, since bs is stricter by design) |
| `claude-config.checkout` | `~/.claude is a git checkout` / `is not a git checkout` |
| `claude-config.clean` | `~/.claude clean vs origin` / `has N changed path(s)` |
| `claude-config.settings-valid` | `settings.json is valid JSON` / `missing or invalid` |
| `claude-config.hooks-match` | `hooks match canonical-hooks.json` / `hooks block differs` |
| `claude-config.template-keys` | `carries every template key` / `settings template drift` |
| `secrets.mecp-api-key` | `MeCP API key present` / `no MeCP API key` |

- [ ] **Step 1: Write the normalizer and the test**

`tests/parity/normalize.ts`:
```ts
export type Status = "ok" | "warn" | "error";
export const PARITY_MAP: Array<{ id: string; bash: RegExp }> = [
  { id: "prereqs.git", bash: /prereq(?: missing)?: git\b/ }, { id: "prereqs.curl", bash: /prereq(?: missing)?: curl\b/ }, { id: "prereqs.jq", bash: /prereq(?: missing)?: jq\b/ },
  { id: "prereqs.python", bash: /prereq(?: missing)?: python/ }, { id: "prereqs.node", bash: /prereq(?: missing \(install manually\))?: node\b/ }, { id: "prereqs.claude", bash: /prereq(?: missing \(install manually\))?: claude\b/ },
  { id: "claude-config.checkout", bash: /~\/\.claude is (?:a|not a) git checkout/ }, { id: "claude-config.clean", bash: /~\/\.claude (?:clean vs origin|has \d+ changed path)/ },
  { id: "claude-config.settings-valid", bash: /settings\.json (?:is valid JSON|missing or invalid)/ }, { id: "claude-config.hooks-match", bash: /hooks (?:match canonical|block differs)/ },
  { id: "claude-config.template-keys", bash: /(?:carries every template key|settings template drift)/ }, { id: "secrets.mecp-api-key", bash: /(?:MeCP API key present|no MeCP API key)/ },
];
const ICONS: Record<string, Status> = { "✓": "ok", "!": "warn", "✗": "error" };

export function parseBashDoctor(text: string): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const m = /^\s*([✓!✗])\s+(.*)$/.exec(line);
    if (!m) continue;
    for (const p of PARITY_MAP) if (p.bash.test(m[2]) && !(p.id in out)) out[p.id] = ICONS[m[1]];
  }
  return out;
}
```

`tests/parity/doctor-parity.test.ts`:
```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARITY_MAP, parseBashDoctor } from "./normalize.ts";

const BOOTSTRAP = path.join(homedir(), ".claude", "bootstrap.sh");
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, DEVICE_LABEL: process.env.DEVICE_LABEL ?? "" } });

describe.skipIf(!existsSync(BOOTSTRAP))("doctor parity (gate 1)", () => {
  it("bs doctor --json agrees with bootstrap.sh --doctor on every shared check", () => {
    const bash = run("bash", [BOOTSTRAP, "--doctor"]);
    const bashMap = parseBashDoctor(bash.stdout + bash.stderr);
    const bs = run("npx", ["tsx", "src/cli.ts", "doctor", "--json"]);
    const j = JSON.parse(bs.stdout) as { checks: Record<string, Array<{ id: string; status: string }>> };
    const bsMap: Record<string, string> = {};
    for (const [artifact, checks] of Object.entries(j.checks)) for (const c of checks) bsMap[`${artifact}.${c.id}`] = c.status;

    const diffs: string[] = [];
    for (const { id } of PARITY_MAP) {
      const b = bashMap[id], t = bsMap[id];
      if (b === undefined) { diffs.push(`${id}: not found in bash output`); continue; }
      if (t === undefined) { diffs.push(`${id}: not found in bs output`); continue; }
      if (id === "prereqs.node" && b === "warn" && t !== "error") continue;  // bs is stricter on node by design
      if (b !== t) diffs.push(`${id}: bash=${b} bs=${t}`);
    }
    expect(diffs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it on this mac**

Run: `npm run test:parity`
Expected: 1 passed with an empty `diffs` array. If a row differs, the bs artifact is wrong (bash is the reference at gate 1) — fix the artifact, not the map, unless the map's regex missed a line (check by printing `bashMap`).

- [ ] **Step 3: Commit**

```bash
git add tests/parity
git commit -m "test(parity): doctor parity gate against bootstrap.sh --doctor"
```

---

### Task 13: CI, README, and spec touch-ups

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md` (§3 `SecretService` gains `mecp-api-key`; note that `~/.config/mecp/api_key` is that service's store because the hook reads a file)
- Modify: `.gitignore` (add `.config/`, `*.jsonl` under runs if any get created locally)

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: node dist/cli.js env
      # Parity needs ~/.claude/bootstrap.sh, which hosted runners don't have; the suite skips itself.
      - run: npm run test:parity
```

- [ ] **Step 2: Write the README**

`README.md`:
```markdown
# boot-slapper

Cross-platform onboarding for Claude Code (and, from Phase 3, Claude Desktop) against a
third-party inference provider — first target: the Cornell AI gateway with no claude.ai
sign-in. Supersedes `dotclaude/bootstrap.sh` and the `claude-gw.zsh` wrapper.

Design: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`.

## Commands

    bs env                                  # what this box looks like (os, label, detected provider)
    bs plan    [--profile aca34]            # what onboard WOULD do — read-only
    bs doctor  [--profile aca34] [--json]   # verify every artifact — read-only, exit 1 on any error
    bs onboard [--profile aca34] [--auto]   # plan → confirm → apply → verify; --auto skips prompts
    bs secrets set|check <service>          # cornell-ai-gateway | mecp-device-token | mecp-api-key | mct-sync-token

Secrets live in the login Keychain (macOS) or Windows Credential Manager; `mecp-api-key`
lives in `~/.config/mecp/api_key` because the SessionStart hook reads that file. Values are
entered at a hidden prompt and reach child processes on stdin only.

## Develop

    npm install && npm test          # unit tests against the recording io fake
    npm run test:parity              # gate 1: bs doctor vs ~/.claude/bootstrap.sh --doctor (skips without dotclaude)
    npm run build && node dist/cli.js plan

Phase map and task-level plan: `docs/superpowers/plans/2026-09-09-boot-slapper-phase1-engine.md`.
```

- [ ] **Step 3: Update the spec §3 enum and the .gitignore**

In the spec, change the `SecretRef` type line to:
```ts
type SecretRef = { service: "cornell-ai-gateway" | "mecp-device-token" | "mecp-api-key" | "mct-sync-token"; account: string };
```
and add a row under the SecretStore table:
```
| any | `~/.config/mecp/api_key` (mode 600) for `mecp-api-key` only — the file is the contract `load-mecp-context.mjs` reads (bootstrap.sh step 5) |
```

`.gitignore` gains:
```
.config/
```

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npm run typecheck && npm test && npm run test:parity`
Expected: all green; parity 1 passed.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md .gitignore docs/superpowers/specs/2026-09-09-boot-slapper-design.md
git commit -m "chore: CI matrix, README, spec: mecp-api-key secret service"
```

---

## Self-review

**Spec coverage (Phase 1 scope):**
- §2 Env/Artifact/Profile/Plan/commands — Tasks 2, 3, 5, 11. `bs capture` and `bs migrate` are Phase 2 / B, as the spec's phase map states.
- §2 invariants 1–6 — enforced by tests: never-write (`io.writes` asserted empty in `plan`), apply-twice-empty (Tasks 8, 10), no secret in argv/events (Tasks 4, 9), adopt-never-clobber (Task 8 adopt test), non-transferable no-apply (arrives with `hosted-connectors` in Phase 3).
- §3 SecretStore + backends + generated wrappers + deliberately-manual steps — Tasks 4, 9, 10.
- §4 rows 1–4 — Tasks 7–10. Rows 5–12 — Phases 2–3.
- §5 engine/UI boundary, headless reporter, run log — Task 11 (Ink TUI is Phase 2).
- §6 gate 1 — Task 12. Gates 2–3 — Phase 3.
- §7 layout, error classes (blocked / apply failure / drift), testing (unit per artifact, secrets backends smoke, parity) — Tasks 1–12; Windows PasswordVault live test runs in the CI windows job only through the unit fake in Phase 1 — a live PasswordVault smoke is added when the Windows box exists (Phase 3 gate 2).

**Placeholder scan:** none remaining (the Task 5 `optsFor` scaffold and the Task 7 node-message note were removed).

**Type consistency:** `Ctx.opts` is `Record<string, unknown>`; `resolvePlan` passes `profile.options[id]` via `withOpts`; `applyPlan` reads `ctx.opts[id]` — the CLI sets `ctx.opts = profile.options` (Task 11 `buildCtx`), so both paths see the same per-artifact object. `State.details` is optional on `absent` and required on `drifted`; every `plan()` guards with `state.details ?? []`. `FakeIo` constructor init type is reused by `makeCtx` in `tests/unit/helpers.ts`.

## Roadmap — Phase 2 and Phase 3 task outlines (expanded into their own plans later)

**Phase 2 — remaining code artifacts, TUI, bundle, shims**
1. `project-memory` artifact: port `claude-memory-sync/install.sh` discovery (encoded-cwd → logical-name guessing), `devices/<label>.json` build with `{device_label, platform, mappings}`, coverage check (nothing-mapped-but-dirs-exist = error), `sync-memory --device <label> list|pull`.
2. `mct` artifact: clone/build at `~/projects/me-count-token`, `dist/hooks/session-start.js` presence = the wrapper contract, `mct onboard --device --url --token` with `mct-sync-token` from the store, `mct doctor` warn-only.
3. `plugins` artifact: read `~/.claude/plugins/known_marketplaces.json` + `installed_plugins.json` (v2 schema), restore via `claude plugin marketplace add <source>` / `claude plugin install <name>@<marketplace>`; the profile lists marketplaces + plugin ids.
4. Ink TUI: Plan / Apply / Doctor screens over the same events; `tests/parity/skins.test.ts` diffs `doctor --json` after a TUI-driven and a headless run.
5. `bs capture --out <dir>`: manifest schema 1, allowlist-driven `claude-config/`, `plugins.json`, `memory/` logical tree, `instructions.md`, secret scan refusing `sk-`/`Bearer `/token-shaped strings.
6. `install.sh` / `install.ps1` fresh-box shims (node ≥ 22.5 via brew/winget, clone, `npm ci && npm run build`, exec `bs onboard`).
7. Deferred from the Phase 1 final-review fix wave (cheap engine/UI cleanups, not required for gate 1):
   - `State.facts` structured channel so `plan()` stops parsing detail strings; export detail-prefix constants meanwhile.
   - `PlanEntry.opts` so `applyPlan` never reads `ctx.opts`; per-artifact required-option asserts.
   - Drop/`blocked`-mark cross-surface `requires` edges instead of throwing in `resolveOrder`; dedupe `requires`.
   - `tsconfig` typecheck for `tests/`; `runLogWriter` chain guard + append-only writes; `_writeToOutput` missing-method guard; non-44 exit codes surfaced in doctor; `doctor --json` redaction before committing as evidence; `BS_REQUIRE_PARITY=1`; `homeRel` path-boundary check; `gateway-launch` runner-specific detail text and `.bak` before overwriting a differing wrapper.

**Phase 3 — desktop + cutover**
1. Spike S1 (Desktop 3P config via user defaults / HKCU vs managed prefs) → `docs/spikes/s1-desktop-config.md`.
2. Spike S2 (Desktop HTTP MCP with bearer header vs `mcp-remote` bridge) → `docs/spikes/s2-desktop-mcp.md`; the probe becomes `desktop-mcp`'s capability check.
3. `desktop-inference`, `desktop-mcp`, `desktop-skills`, `open-brain-auth`, `hosted-connectors` artifacts; profile `aca34` gains `surfaces: ["code","desktop"]`.
4. Gate 2 on the two new boxes: `dotclaude/bootstrap.sh` → shim, `dotfiles/install.*` step 3 → shim, delete `dotfiles/zsh/claude-gw.zsh`, rewrite `dotclaude/docs/gateway-sessions.md`.
5. Gate 3 after one clean week: deprecate `claude-memory-sync/install.sh` in place.
