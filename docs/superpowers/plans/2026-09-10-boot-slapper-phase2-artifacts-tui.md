# boot-slapper Phase 2 — Remaining code artifacts, Ink TUI, capture bundle, install shims — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `code` surface of the owner profile: the `project-memory`, `mct`, and `plugins` artifacts (ports of `bootstrap.sh` steps 6–7 and `claude-memory-sync/install.sh`), an Ink TUI over the same engine events with a TUI-vs-headless parity test, `bs capture --out <dir>`, and the fresh-box `install.sh` / `install.ps1` shims — every piece unit-tested against the recording `Io` fake on macOS and Windows CI.

**Architecture:** Nothing about the Phase 1 engine model changes: artifacts still implement `detect` / `plan` / `apply` / `verify` over `Ctx`, and every filesystem or process access goes through `Io`. Phase 2 adds a `capture` hook and `Bundle` type to the artifact contract, a `text` prompt to `Prompter`, and makes the run driver emit every `check:result` so both skins and the run log see the same stream. The TUI is three files of Ink components over a pure reducer (`ui/tui/model.ts`) and a Prompter bridge (`ui/tui/prompter.ts`) — both testable without a renderer. `bs capture` is a driver (`engine/capture.ts`) that collects each artifact's `Bundle`, refuses files from device-bound artifacts, runs a secret scan, and hashes a manifest; the CLI only writes what the driver returns.

**Tech Stack:** TypeScript ≥ 5.7 (the lockfile already resolves one; `rewriteRelativeImportExtensions` needs it), ESM, Node ≥ 22.5, vitest 3, tsx. New runtime dependencies: `ink@^7.1.1` and `react@^19.2.0` (Ink 7 requires React ≥ 19.2). New dev dependency: `@types/react@^19.2.0`. `node:crypto` for manifest hashes. No `ink-testing-library` — see Deviations.

**Spec:** `docs/superpowers/specs/2026-09-09-boot-slapper-design.md` (§4 rows 5–7, §5, §7). **Brief:** the "Roadmap — Phase 2" section at the end of `docs/superpowers/plans/2026-09-09-boot-slapper-phase1-engine.md`. **Sources being ported (read, never shelled to):** `~/.claude/bootstrap.sh` steps 6–7 and its doctor lines 190–312; `~/projects/claude-memory-sync/install.sh`; `~/projects/me-count-token/src/hook-wrapper.ts` (`HOOK_CHECKOUT_PROBES`).

## Global Constraints

All Phase 1 constraints still hold (copied so this file stands alone):

- Node `>=22.5.0`; `"type": "module"`; tsconfig `module: nodenext`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `strict`. Imports use `.ts` / `.tsx` extensions.
- Nothing under `src/engine/` or `src/artifacts/` imports from `src/ui/` (spec §5). Ink and React are imported only under `src/ui/tui/`; `src/ui/tui/model.ts` and `src/ui/tui/prompter.ts` import neither.
- `detect` and `verify` never write. `apply` runs only steps `plan` produced. Re-running `apply` on a satisfied artifact yields an empty plan (spec §2 invariants 1, 2, 6). `capture` never writes either.
- Adopt, never clobber: a differing user-owned file is reported `drifted` and left alone (invariant 3). Files an artifact generates under its own directory are regenerated.
- No secret value in any `Step` text, event, log line, bundle, or child-process argv (invariant 4). Secret values reach child processes via **stdin or a mode-600 file the child already owns** — never argv. Concretely: the mct sync token is written into `~/.mct/config.json` (mct's own store) and mct is run with a bare `onboard`, not `--token`.
- Files are written with a trailing newline, JSON with 2-space indent and LF line endings (device configs are committed to a shared repo; CRLF is diff churn).
- Windows: never spawn a `.cmd` / `.bat` directly (Node ≥ 20.12 refuses without a shell). `npm` runs as `node <…>/node_modules/npm/bin/npm-cli.js` (Task 3 `npmArgv`). Paths for the target OS come from `pj(env.os, …)`, never the host's `path`.
- `bs capture` refuses to include files from `device-bound` / `non-transferable` artifacts and refuses the whole bundle on a secret-scan hit (spec §5).
- Every artifact's `detect`/`verify` exec calls must pass `tests/unit/artifacts/contract.test.ts`'s allowlist; extend the allowlist in the task that adds the artifact.
- Commit after every task with a conventional-commit subject; the harness appends the attribution trailer.
- **Before Task 1:** this checkout has no `node_modules` on this box — run `npm ci` and confirm `npm test` reports 95 passed.

## Phase map

This plan is **Phase 2 of 3**. It ends with `bs onboard` (TUI and `--auto`), `bs doctor`, `bs plan`, `bs capture`, and `bs secrets` covering all seven `code`-surface artifacts, the skins-parity test green, and both shims committed. **Phase 3** (own plan) adds spikes S1/S2, the five `desktop` artifacts, and the cutover gates 2–3.

**Gate reminder (spec §6):** nothing here changes the cutover state. `bootstrap.sh` and `claude-gw.zsh` stay live; only `bs env | plan | doctor | capture` are meant to touch a real box until the two new machines exist. `bs onboard` on this mac is allowed for `--only gateway-launch,plugins,project-memory` once their tests are green, because those three are idempotent and adopt-never-clobber — but run `bs plan` first and read it.

## File structure (Phase 2)

```
package.json                    # + ink, react; + @types/react; test include *.test.tsx
tsconfig.json                   # + "jsx": "react-jsx"
vitest.config.ts                # + esbuild jsx automatic; include tests/**/*.test.{ts,tsx}
install.sh, install.ps1         # fresh-box shims (Task 10)
src/
  cli.ts                        # + capture, --headless, --out; TUI vs headless selection
  engine/
    artifact.ts                 # + Prompter.text, Bundle/BundleFile, Artifact.capture?
    plan.ts                     # + PlanEntry.opts
    run.ts                      # applyPlan uses entry.opts; safeVerify emits every check:result
    ctx.ts                      # buildCtx(io, profile, {interactive, prompt, emit}) — shared by cli + TUI
    walk.ts                     # walkFiles(io, os, root) → posix-relative file list
    capture.ts                  # captureBundle(), scanForSecrets(), SecretScanError, Manifest
  artifacts/
    project-memory.ts           # spec §4 row 5 — port of claude-memory-sync/install.sh + bootstrap step 6 + doctor
    mct.ts                      # row 6 — bootstrap step 7 + doctor
    plugins.ts                  # row 7 — new; known_marketplaces.json + installed_plugins.json (v2)
    claude-config.ts            # + capture (git ls-files)
    secrets.ts, prereqs.ts      # + capture (instructions only)
  profiles/aca34.ts             # + three artifacts, mct-sync-token, plugin list
  ui/
    headless.ts                 # reporter groups check:result lines under ==> <artifact>; doctorSummary()
    prompt.ts                   # + text()
    tui/
      model.ts                  # pure: Model, Action, reduce(), stateLabel(), summary()
      prompter.ts               # pure: bridgePrompter(onPending) → Prompter
      components.tsx            # PlanRows, CheckRows, Notes
      PromptLine.tsx            # one-line input: secret (masked) / text / confirm / gate
      App.tsx                   # drives resolvePlan → confirm → applyPlan (or verifyAll) through the reducer
      index.tsx                 # runTui(opts) → Promise<exit code>
tests/
  unit/engine/{walk,capture}.test.ts, run.test.ts (+2 cases)
  unit/artifacts/{project-memory,mct,plugins}.test.ts; claude-config.test.ts (+capture); contract.test.ts (allowlist + capture rule)
  unit/ui/{prompt,model,prompter,tui}.test.ts, streams.ts (fake stdin/stdout for Ink)
  unit/cli.test.ts (+capture, +headless flag); unit/shims.test.ts
  parity/normalize.ts (+project-memory, mct ids); parity/skins.test.ts (TUI vs headless)
README.md, docs/superpowers/specs/… (touch-ups)
```

## Deviations from the brief (decided here; repeat them in the phase report)

1. **mct token delivery.** Spec §4 row 6 and `bootstrap.sh` pass `--token` on argv. That violates the no-secret-on-argv constraint, and mct has no env/stdin path for the sync token. The artifact instead seeds `~/.mct/config.json` (`{deviceId, syncUrl, syncToken}`, mode 600 — the file mct itself keeps the token in) and runs a bare `mct onboard`, which mct documents as a repair pass (keeps every config value, verifies token↔device, installs hooks/OTEL, scans, syncs, doctors). boot-slapper writes that file only when it is absent, so it is a bootstrap, not a second writer.
2. **project-memory guessing and config shape.** `install.sh` took the *first* sorted logical name that is a substring of the encoded dir; this port takes the *longest* (so `mecp` no longer shadows `mecp-handoffs`). The `platform` field is written as `env.os` (`darwin` / `win32` / `linux`), not `uname -s` (informational per the memory-sync README). An existing config is **extended append-only** with newly discovered, guessable dirs instead of "rm the file to rebuild"; existing mappings are never changed. Unmapped dirs with no guess are doctor warnings (matching the bash doctor), never plan steps — that is what keeps `apply` idempotent.
3. **Ink testing.** `ink-testing-library@4` declares Ink 5 as its dev dependency and is unverified on Ink 7; its whole runtime is a fake stdin/stdout pair, so `tests/unit/ui/streams.ts` carries our own 30-line version and the TUI is rendered with `debug: true` (Ink then writes every full frame, which also sidesteps Ink's CI-mode output suppression on GitHub runners).
4. **Deferred cleanups (Phase 1 roadmap item 7).** Landing now: `Prompter.text`, `PlanEntry.opts`, engine-emitted `check:result`, `runLogWriter` append-only. Still deferred (unchanged reasons): `State.facts`, cross-surface `requires` handling in `resolveOrder` (Phase 3 needs it and should own it), `tsconfig` typecheck for `tests/`, `_writeToOutput` guard, non-44 Keychain exit codes, `doctor --json` redaction, `BS_REQUIRE_PARITY=1`, `homeRel` boundary check, gateway-launch `.bak` before regenerating a differing wrapper.

---

### Task 1: Engine touch-ups — `Prompter.text`, `PlanEntry.opts`, `capture` hook, emitted checks, `walkFiles`

**Files:**
- Modify: `src/engine/artifact.ts`, `src/engine/plan.ts`, `src/engine/run.ts`, `src/ui/prompt.ts`, `src/ui/headless.ts`, `src/cli.ts` (onboard tail only), `tests/unit/helpers.ts`, `tests/unit/engine/run.test.ts`, `tests/unit/ui/headless.test.ts`
- Create: `src/engine/walk.ts`, `tests/unit/engine/walk.test.ts`, `tests/unit/ui/prompt.test.ts`

**Interfaces:**
- Consumes: everything in Phase 1's `engine/`.
- Produces:
  - `Prompter.text(label: string, fallback?: string): Promise<string>` — non-secret free text; headless throws `InteractiveRequired`; tty returns `fallback` on blank.
  - `interface BundleFile { path: string; content: string }` (bundle-relative posix path); `interface Bundle { files: BundleFile[]; instructions: string[] }`; `Artifact.capture?(ctx: Ctx): Promise<Bundle>`.
  - `PlanEntry.opts: Record<string, unknown>` — `applyPlan` reads it instead of `ctx.opts[id]`.
  - `safeVerify` emits one `check:result` per returned check (thrown verifies still become a single error check).
  - `headlessReporter` prints `==> <artifact>` before the first `check:result` of each artifact; `export function doctorSummary(checks: Record<string, Check[]>): string` returns the `==> Doctor: …` line; `renderChecksText` ends with it.
  - `walkFiles(io: Io, os: Os, root: string): Promise<string[]>` — sorted, posix-relative, skips `.git`, `[]` for a missing root.

- [ ] **Step 1: Write the failing tests**

`tests/unit/engine/walk.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { walkFiles } from "../../../src/engine/walk.ts";

describe("walkFiles", () => {
  it("lists files under a root as sorted posix-relative paths, skipping .git", async () => {
    const io = new FakeIo({ files: { "/r/b.md": "", "/r/a/x.txt": "", "/r/a/y/z.txt": "", "/r/.git/HEAD": "ref", "/elsewhere/q": "" } });
    expect(await walkFiles(io, "darwin", "/r")).toEqual(["a/x.txt", "a/y/z.txt", "b.md"]);
    expect(await walkFiles(io, "darwin", "/missing")).toEqual([]);
  });
});
```

`tests/unit/ui/prompt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { InteractiveRequired } from "../../../src/engine/artifact.ts";
import { headlessPrompter } from "../../../src/ui/prompt.ts";

describe("headlessPrompter", () => {
  it("refuses every prompt kind with InteractiveRequired, including text", async () => {
    const p = headlessPrompter();
    await expect(p.text("device id", "x")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.secret("s")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.confirm("c")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.gate("g")).rejects.toBeInstanceOf(InteractiveRequired);
  });
});
```

Append to `tests/unit/engine/run.test.ts` inside `describe("applyPlan", …)`:
```ts
  it("hands each artifact its own profile options via PlanEntry.opts, not ctx.opts", async () => {
    const { ctx } = await makeCtx();
    const seen: unknown[] = [];
    const a: Artifact = { ...art("a", { absent: true }), apply: async (c) => { seen.push(c.opts); }, verify: async (c) => { seen.push(c.opts); return []; } };
    const p: Profile = { ...profile([a]), options: { a: { flag: 1 } } };
    const plan = await resolvePlan(p, ctx);
    expect(plan[0].opts).toEqual({ flag: 1 });
    await applyPlan(plan, { ...ctx, opts: {} });
    expect(seen).toEqual([{ flag: 1 }, { flag: 1 }]);
  });
  it("emits one check:result per check from verify, in both drivers", async () => {
    const { ctx, events } = await makeCtx();
    const a = art("a", {});
    await applyPlan(await resolvePlan(profile([a]), ctx), ctx);
    expect(events.filter((e) => e.type === "check:result")).toEqual([{ type: "check:result", artifact: "a", check: { id: "a.ok", status: "ok", message: "fine" } }]);
    events.length = 0;
    await verifyAll(profile([a]), ctx);
    expect(events.filter((e) => e.type === "check:result")).toHaveLength(1);
  });
```
Also add `text: async (l) => { if (!interactive) throw new InteractiveRequired(l); return "v"; },` to the `prompt` object in that file's `makeCtx` (the `Prompter` type gains a required member).

In `tests/unit/ui/headless.test.ts`, change the expected array of the first test to insert `"==> prereqs"` immediately before `"    ✓ prereq: git"` (the reporter now groups check lines).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/engine tests/unit/ui`
Expected: FAIL — `walk.ts` not found; `text` missing on the prompters (type error surfaces at runtime as `p.text is not a function`); `PlanEntry.opts` undefined; zero `check:result` events; headless expectation mismatch.

- [ ] **Step 3: Implement**

`src/engine/artifact.ts` — replace the `Prompter` interface and extend `Artifact`:
```ts
export interface Prompter {
  secret(label: string): Promise<string>;
  /** Non-secret free text (device ids, logical names). Headless throws InteractiveRequired; a blank answer returns `fallback`. */
  text(label: string, fallback?: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
  gate(label: string): Promise<void>;
}

/** What `bs capture` writes for one artifact. `path` is bundle-relative with posix separators. */
export interface BundleFile { path: string; content: string }
export interface Bundle { files: BundleFile[]; instructions: string[] }

export interface Artifact {
  id: string;
  surfaces: Surface[];
  portability: Portability;
  requires: string[];
  detect(ctx: Ctx): Promise<State>;
  plan(ctx: Ctx, state: State): Step[];
  apply(ctx: Ctx, steps: Step[]): Promise<void>;
  verify(ctx: Ctx): Promise<Check[]>;
  /** Read-only. device-bound / non-transferable artifacts may return instructions but never files (engine/capture.ts enforces it). */
  capture?(ctx: Ctx): Promise<Bundle>;
}
```

`src/engine/plan.ts` — `PlanEntry` gains `opts`; `resolvePlan` fills it:
```ts
export interface PlanEntry { artifact: Artifact; state: State; steps: Step[]; opts: Record<string, unknown> }
export type Plan = PlanEntry[];
```
and inside the loop: `const opts = profile.options[artifact.id] ?? {}; const c = withOpts(ctx, opts);` … `plan.push({ artifact, state, steps, opts });`.

`src/engine/run.ts` — `safeVerify` emits every check; both `withOpts(ctx, (ctx.opts as …)[…])` lines become `withOpts(ctx, entry.opts)`:
```ts
async function safeVerify(artifact: Artifact, c: Ctx, emit: Ctx["emit"]): Promise<Check[]> {
  let checks: Check[];
  try { checks = await artifact.verify(c); }
  catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    checks = [{ id: "verify", status: "error", message: `verify threw: ${error}` }];
  }
  for (const check of checks) emit({ type: "check:result", artifact: artifact.id, check });
  return checks;
}
```
In `applyPlan`, the first loop's `const c = withOpts(ctx, (ctx.opts as Record<string, Record<string, unknown>>)[artifact.id]);` → `const c = withOpts(ctx, entry.opts);` and the verify loop's `const c = withOpts(ctx, (ctx.opts as …)[entry.artifact.id]);` → `const c = withOpts(ctx, entry.opts);`.

`src/engine/walk.ts`:
```ts
import { pj, type Os } from "./env.ts";
import type { Io } from "./io.ts";

/** Every file under `root`, as sorted posix-relative paths. Skips `.git`. A missing root yields []. */
export async function walkFiles(io: Io, os: Os, root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, rel: string): Promise<void> {
    for (const name of (await io.readdir(dir)).sort()) {
      if (name === ".git") continue;
      const p = pj(os, dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (await io.isDir(p)) await rec(p, r); else out.push(r);
    }
  }
  if (await io.isDir(root)) await rec(root, "");
  return out;
}
```

`src/ui/prompt.ts` — add `text` to both prompters:
```ts
export function headlessPrompter(): Prompter {
  return {
    secret: async (l) => { throw new InteractiveRequired(l); },
    text: async (l) => { throw new InteractiveRequired(l); },
    confirm: async (l) => { throw new InteractiveRequired(l); },
    gate: async (l) => { throw new InteractiveRequired(l); },
  };
}
// in ttyPrompter():
    text: async (label, fallback) => {
      const a = (await ask(`    ${label}${fallback ? ` [${fallback}]` : ""}: `, false)).trim();
      return a || fallback || "";
    },
```

`src/ui/headless.ts` — group check lines and factor the summary:
```ts
export function headlessReporter(sink: Sink): (e: EngineEvent) => void {
  let checkGroup: string | null = null;
  return (e) => {
    switch (e.type) {
      case "artifact:detected": sink.write(`==> ${e.id}: ${e.state.kind}${"details" in e.state && e.state.details?.length ? " — " + e.state.details.join("; ") : e.state.kind === "blocked" ? " — " + e.state.reason : ""}`); break;
      case "artifact:skipped": sink.write(`==> ${e.id}: skipped — ${e.reason}`); break;
      case "step:start": sink.write(`    … ${e.step.title}`); break;
      case "step:done": sink.write(e.ok ? `    ✓ ${e.step.title}` : `    ✗ ${e.step.title} — ${e.error ?? "failed"}`); break;
      case "prompt:needed": sink.write(`    ? ${e.step.title}`); break;
      case "check:result":
        if (e.artifact !== checkGroup) { checkGroup = e.artifact; sink.write(`==> ${e.artifact}`); }
        sink.write(`    ${ICON[e.check.status]} ${e.check.message}`); break;
      case "note": sink.write(`    ${e.level === "info" ? "·" : ICON[e.level]} ${e.message}`); break;
    }
  };
}

export function doctorSummary(checks: Record<string, Check[]>): string {
  const failures = Object.values(checks).flat().filter((c) => c.status === "error").length;
  return failures ? `==> Doctor: ${failures} check(s) FAILED` : "==> Doctor: all checks passed";
}

export function renderChecksText(checks: Record<string, Check[]>): string {
  const lines: string[] = [];
  for (const [id, cs] of Object.entries(checks)) {
    lines.push(`==> ${id}`);
    for (const c of cs) lines.push(`    ${ICON[c.status]} ${c.message}`);
  }
  lines.push(doctorSummary(checks));
  return lines.join("\n") + "\n";
}
```
`runLogWriter` becomes append-only (no read-modify-write): replace the `emit` body with
```ts
      chain = chain.then(() => io.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n", { mode: 0o600 }));
```
and add `appendFile` to `Io` (`src/engine/io.ts`): interface `appendFile(p: string, s: string, opts?: { mode?: number }): Promise<void>`; `RealIo`: `await fs.mkdir(path.dirname(p), { recursive: true }); await fs.appendFile(p, s, { encoding: "utf8", mode: opts?.mode });`; `FakeIo`: `await this.writeFile(p, (this.files.get(p) ?? "") + s, opts);`.

Also in `src/engine/io.ts`, the `FakeIo` constructor registers parents for `init.dirs` the way it already does for `init.files` — add `for (const d of [...this.dirs]) this.addParents(d);` right after the files loop. Without it `readdir` of the parent of an init dir returns nothing; Tasks 2 and 3 discover memory dirs and checkouts through `readdir` / `isDir` on exactly those parents. Test fakes that materialise a clone should use `await io.mkdirp(d)` for the same reason.

`src/cli.ts` — in `case "onboard"`, the live reporter now prints every check, so replace `stdout.write(renderChecksText(res.checks).trimEnd());` with `stdout.write(doctorSummary(res.checks));` and import `doctorSummary` (keep `renderChecksText` for `doctor`, whose ctx uses a silent emitter).

`tests/unit/helpers.ts` — add to the `prompt` object:
```ts
      text: async (label, fallback) => { if (!interactive) throw new InteractiveRequired(label); return init.answers?.[label] ?? fallback ?? ""; },
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (95 + 4 new). If the headless test still fails, the expected array must read `"==> prereqs"` before the two check lines — nothing else changed there.

- [ ] **Step 5: Commit**

```bash
git add src/engine/artifact.ts src/engine/plan.ts src/engine/run.ts src/engine/walk.ts src/engine/io.ts src/ui/prompt.ts src/ui/headless.ts src/cli.ts tests/unit/helpers.ts tests/unit/engine/run.test.ts tests/unit/engine/walk.test.ts tests/unit/ui/prompt.test.ts tests/unit/ui/headless.test.ts
git commit -m "feat(engine): Prompter.text, PlanEntry.opts, capture hook + Bundle types, emitted check:result, walkFiles, append-only run log"
```

---

### Task 2: Artifact `project-memory` (port of `claude-memory-sync/install.sh` + bootstrap step 6 + doctor)

**Files:**
- Create: `src/artifacts/project-memory.ts`, `tests/unit/artifacts/project-memory.test.ts`
- Modify: `src/profiles/aca34.ts`, `tests/unit/artifacts/contract.test.ts`, `tests/parity/normalize.ts`

**Interfaces:**
- Consumes: `cloneUrl(io, ssh, https)` (exported by `src/artifacts/claude-config.ts`), `walkFiles` (Task 1), `pj` (`engine/env.ts`), `Prompter.text` (Task 1).
- Options: `{ sshUrl: string; httpsUrl: string; dir?: string }` — `dir` defaults to `~/projects/claude-memory-sync` (`bootstrap.sh` `MEMSYNC_DIR`).
- Produces: `export const projectMemory: Artifact` (id `project-memory`, surfaces `["code"]`, `portable`, requires `["claude-config"]`); `export const HOOK_SCRIPTS`; `export const D` (detail prefixes); `export function guessLogical(encoded, known): string | null`; `export const fwd(p)`, `export const bashPath(p)`; `export interface DeviceConfig`.
- Step ids: `project-memory.clone`, `project-memory.device-config`, `project-memory.sync`.

What it does, mapped to the sources it replaces:

| Source | Port |
|---|---|
| bootstrap step 6 clone | `clone` step: `git clone --quiet <ssh|https> ~/projects/claude-memory-sync` |
| bootstrap `mkdir -p ~/.claude/projects`; install.sh `mkdir -p ~/.claude/logs` | first thing in the `device-config` step |
| install.sh §2 hook-script presence (owned by dotclaude; never copied) | `verify` check `hook-scripts` (error when missing) — never written here |
| install.sh §3 discovery: `~/.claude/projects/*/memory` → guess logical name from `projects/` in the repo → ask → write `{device_label, platform, mappings}` LF | `device-config` step; longest-substring guess (Deviation 2); interactive `prompt.text` with the guess as default; headless takes the guess; blank = skip with a warn note; existing keys never changed |
| install.sh §4 push-then-pull | `sync` step, push first (the 2026-08-16 mirror-delete incident); push exit 3 = conflict sidecars → warn and continue; pull failure → step fails |
| doctor lines 190–279 (repo present, config exists, `sync-memory list` resolves, coverage) | `verify` checks `repo`, `device-config`, `resolves`, `coverage`, same messages, same severities |
| install.sh §5 API-key instructions | already the `secrets` artifact (`mecp-api-key`) — nothing here |

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/project-memory.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { bashPath, fwd, guessLogical, projectMemory } from "../../../src/artifacts/project-memory.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { sshUrl: "git@github.com:merpuya/claude-memory-sync.git", httpsUrl: "https://github.com/merpuya/claude-memory-sync.git" };
const REPO = "/h/projects/claude-memory-sync";
const scripts = { "/h/.claude/scripts/memory-auto-sync.mjs": "", "/h/.claude/scripts/load-mecp-context.mjs": "" };
const repoDirs = [`${REPO}/.git`, `${REPO}/projects/mecp`, `${REPO}/projects/mecp-handoffs`, `${REPO}/projects/dotfiles`, `${REPO}/devices`];
const MEM = (enc: string) => `/h/.claude/projects/${enc}/memory`;
const memDirs = [MEM("-Users-aca34-projects-mecp"), MEM("-Users-aca34-projects-mecp-handoffs"), MEM("-Users-aca34-scratch")];

function fakes(io: FakeIo, codes: { push?: number; pull?: number; list?: number } = {}) {
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "Hi merpuya! You've successfully authenticated" }));
  io.on((c, a) => c === "bash" && /sync-memory$/.test(a[0] ?? ""), ({ args }) => ({ code: codes[args[3] as keyof typeof codes] ?? 0, stdout: "", stderr: args[3] === "push" ? "[conflict] x.md\n" : "" }));
  io.on((c, a) => c === "git" && a[0] === "clone", async () => { for (const d of repoDirs) await io.mkdirp(d); return { code: 0, stdout: "", stderr: "" }; });
}

describe("guessLogical", () => {
  it("picks the longest known name contained in the encoded dir, or null", () => {
    const known = ["mecp", "mecp-handoffs", "dotfiles"];
    expect(guessLogical("-Users-aca34-projects-mecp-handoffs", known)).toBe("mecp-handoffs");
    expect(guessLogical("-Users-aca34-projects-mecp", known)).toBe("mecp");
    expect(guessLogical("-Users-aca34-scratch", known)).toBeNull();
  });
  it("path helpers: forward slashes for device files, /c/… for Git Bash", () => {
    expect(fwd("C:\\Users\\t\\.claude\\projects\\x\\memory")).toBe("C:/Users/t/.claude/projects/x/memory");
    expect(bashPath("C:\\Users\\t\\projects\\claude-memory-sync\\bin\\sync-memory")).toBe("/c/Users/t/projects/claude-memory-sync/bin/sync-memory");
    expect(bashPath("/h/projects/claude-memory-sync/bin/sync-memory")).toBe("/h/projects/claude-memory-sync/bin/sync-memory");
  });
});

describe("project-memory", () => {
  it("fresh box (--auto): clone → build the device config from guesses → push, then pull; the next plan is empty", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { DEVICE_LABEL: "NEWBOX" }, dirs: memDirs, files: scripts });
    fakes(io);
    const s1 = await projectMemory.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: [`claude-memory-sync repo absent — will clone to ${REPO}`] });
    const steps = projectMemory.plan(ctx, s1);
    expect(steps.map((x) => x.id)).toEqual(["project-memory.clone", "project-memory.device-config", "project-memory.sync"]);
    await projectMemory.apply(ctx, steps);
    expect(io.calls.find((c) => c.cmd === "git")?.args).toEqual(["clone", "--quiet", opts.sshUrl, REPO]);
    const raw = io.files.get(`${REPO}/devices/NEWBOX.json`)!;
    expect(JSON.parse(raw)).toEqual({ device_label: "NEWBOX", platform: "darwin", mappings: {
      mecp: MEM("-Users-aca34-projects-mecp"),
      "mecp-handoffs": MEM("-Users-aca34-projects-mecp-handoffs"),
    } });
    expect(raw.endsWith("}\n")).toBe(true);
    expect(raw).not.toContain("\r");
    expect(events).toContainEqual({ type: "note", level: "warn", message: "project-memory: skipped -Users-aca34-scratch (no logical name)" });
    expect(io.calls.filter((c) => c.cmd === "bash").map((c) => c.args.slice(1))).toEqual([["--device", "NEWBOX", "push"], ["--device", "NEWBOX", "pull"]]);
    expect(io.dirs.has("/h/.claude/projects")).toBe(true);
    expect(io.dirs.has("/h/.claude/logs")).toBe(true);
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "present" });
    expect(projectMemory.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("existing config is extended append-only with newly guessable dirs; mapped and unguessable dirs are left alone", async () => {
    const cfg = { device_label: "BOX", platform: "darwin", note: "kept", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } };
    const { ctx, io } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs, MEM("-Users-aca34-projects-dotfiles")], files: { ...scripts, [`${REPO}/devices/BOX.json`]: JSON.stringify(cfg, null, 2) + "\n" } });
    fakes(io);
    const s = await projectMemory.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["unmapped memory dir(s): -Users-aca34-projects-dotfiles, -Users-aca34-projects-mecp-handoffs — will map into devices/BOX.json"] });
    const steps = projectMemory.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["project-memory.device-config", "project-memory.sync"]);
    await projectMemory.apply(ctx, steps);
    const after = JSON.parse(io.files.get(`${REPO}/devices/BOX.json`)!);
    expect(Object.keys(after)).toEqual(["device_label", "platform", "note", "mappings"]);
    expect(after.mappings).toEqual({ mecp: MEM("-Users-aca34-projects-mecp"), dotfiles: MEM("-Users-aca34-projects-dotfiles"), "mecp-handoffs": MEM("-Users-aca34-projects-mecp-handoffs") });
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "present" });   // scratch stays unmapped (no guess) and is not drift
  });

  it("interactive: the answer wins over the guess, blank skips, a logical name already mapped is never remapped", async () => {
    const { ctx, io, events } = await makeCtx({ opts, interactive: true, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs, MEM("-Users-aca34-projects-mecp-.worktrees-x")], files: scripts, answers: {
      "encoded '-Users-aca34-scratch' → logical name (blank to skip)": "scratch",
      "encoded '-Users-aca34-projects-mecp-handoffs' → logical name (blank to skip)": "",
    } });
    fakes(io);
    await projectMemory.apply(ctx, [{ id: "project-memory.device-config", title: "" }]);
    const after = JSON.parse(io.files.get(`${REPO}/devices/BOX.json`)!);
    expect(after.mappings).toEqual({ mecp: MEM("-Users-aca34-projects-mecp"), scratch: MEM("-Users-aca34-scratch") });
    expect(events.map((e) => e.type === "note" ? e.message : "")).toEqual(expect.arrayContaining([
      expect.stringMatching(/'mecp' already maps to .* — not remapping to -Users-aca34-projects-mecp-\.worktrees-x/),
      "project-memory: skipped -Users-aca34-projects-mecp-handoffs (no logical name)",
    ]));
  });

  it("sync: a push conflict (exit 3) warns and still pulls; a failing pull fails the step", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(io, { push: 3 });
    await projectMemory.apply(ctx, [{ id: "project-memory.sync", title: "" }]);
    expect(events.find((e) => e.type === "note" && /push exited 3 \(conflicts/.test(e.message))).toBeTruthy();
    expect(io.calls.filter((c) => c.cmd === "bash")).toHaveLength(2);
    const { ctx: ctx2, io: io2 } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(io2, { pull: 1 });
    await expect(projectMemory.apply(ctx2, [{ id: "project-memory.sync", title: "" }])).rejects.toThrow(/sync-memory pull failed/);
  });

  it("verify mirrors the bootstrap doctor: repo, hook scripts, config, resolution, coverage", async () => {
    const { ctx: none } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" } });
    expect(await projectMemory.verify(none)).toEqual([{ id: "repo", status: "error", message: `claude-memory-sync repo missing at ${REPO} — run bs onboard` }]);

    const { ctx: dead, io: ioDead } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: { [`${REPO}/devices/BOX.json`]: "{\"device_label\":\"BOX\",\"platform\":\"darwin\",\"mappings\":{}}\n" } });
    fakes(ioDead);
    const checks = await projectMemory.verify(dead);
    expect(checks.map((c) => [c.id, c.status])).toEqual([["repo", "ok"], ["hook-scripts", "error"], ["device-config", "ok"], ["resolves", "ok"], ["coverage", "error"]]);
    expect(checks[4].message).toMatch(/maps NOTHING but memory dirs exist — sync is dead: -Users-aca34-projects-mecp -Users-aca34-projects-mecp-handoffs -Users-aca34-scratch/);
    expect(ioDead.calls.filter((c) => c.cmd === "bash").map((c) => c.args.slice(1))).toEqual([["--device", "BOX", "list"]]);

    const { ctx: partial, io: ioPartial } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: { ...scripts, [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } }) } });
    fakes(ioPartial, { list: 1 });
    const c2 = await projectMemory.verify(partial);
    expect(c2.find((c) => c.id === "resolves")).toMatchObject({ status: "error" });
    expect(c2.find((c) => c.id === "coverage")).toMatchObject({ status: "warn", message: expect.stringMatching(/^1 mapped; these memory dirs are NOT synced: /) });

    const { ctx: missing } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: scripts });
    expect((await projectMemory.verify(missing)).map((c) => [c.id, c.status])).toEqual([["repo", "ok"], ["hook-scripts", "ok"], ["device-config", "error"]]);
  });

  it("an invalid device config blocks instead of being overwritten", async () => {
    const { ctx } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: { ...scripts, [`${REPO}/devices/BOX.json`]: "{nope" } });
    expect(await projectMemory.detect(ctx)).toEqual({ kind: "blocked", reason: "devices/BOX.json is not valid JSON — fix it by hand, then re-run" });
    expect((await projectMemory.verify(ctx)).find((c) => c.id === "device-config")).toMatchObject({ status: "error", message: expect.stringMatching(/not valid JSON/) });
  });

  it("capture: the logical-name memory tree from the device config; nothing when there is no config", async () => {
    const { ctx } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: {
      ...scripts,
      [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: { mecp: MEM("-Users-aca34-projects-mecp") } }),
      [`${MEM("-Users-aca34-projects-mecp")}/MEMORY.md`]: "- [x](x.md)\n", [`${MEM("-Users-aca34-projects-mecp")}/x.md`]: "fact\n",
    } });
    const b = await projectMemory.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["memory/mecp/MEMORY.md", "memory/mecp/x.md"]);
    const { ctx: nocfg } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: repoDirs, files: scripts });
    expect((await projectMemory.capture!(nocfg)).files).toEqual([]);
  });

  it("detect and verify never write", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { DEVICE_LABEL: "BOX" }, dirs: [...repoDirs, ...memDirs], files: scripts });
    fakes(io);
    await projectMemory.detect(ctx); await projectMemory.verify(ctx);
    expect(io.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/project-memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/project-memory.ts`**

```ts
import path from "node:path";
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj, type Os } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";
import { walkFiles } from "../engine/walk.ts";
import { cloneUrl } from "./claude-config.ts";

const ID = "project-memory";
const step = (s: string, title: string): Step => ({ id: `${ID}.${s}`, title });
interface Opts { sshUrl: string; httpsUrl: string; dir?: string }

/** The wired node ports; tracked files of the dotclaude checkout (install.sh §2). Never copied here. */
export const HOOK_SCRIPTS = ["memory-auto-sync.mjs", "load-mecp-context.mjs"] as const;
export interface DeviceConfig { device_label: string; platform: string; mappings: Record<string, string>; [k: string]: unknown }

/** detect → plan channel: State.details prefixes. */
export const D = { clone: "claude-memory-sync repo absent", config: "no device config for", unmapped: "unmapped memory dir(s):" } as const;

/** Device files are committed and shared across machines; the fleet writes C:/Users/… on Windows. */
export const fwd = (p: string) => p.replace(/\\/g, "/");
/** Git Bash script argument: /c/Users/… ; posix paths pass through. */
export const bashPath = (p: string) => fwd(p).replace(/^([A-Za-z]):\//, (_m, d: string) => `/${d.toLowerCase()}/`);
const norm = (p: string, os: string) => { const s = fwd(p).replace(/\/+$/, ""); return os === "win32" ? s.toLowerCase() : s; };
const tail = (s: string) => s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");

/** Longest known logical name that is a substring of the encoded dir (install.sh took the first sorted match; longest avoids `mecp` shadowing `mecp-handoffs`). */
export function guessLogical(encoded: string, known: string[]): string | null {
  let best: string | null = null;
  for (const k of known) if (k && encoded.includes(k) && (best === null || k.length > best.length)) best = k;
  return best;
}

async function readJson(io: Io, p: string): Promise<Record<string, unknown> | null | "invalid"> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { const v = JSON.parse(s) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : "invalid"; }
  catch { return "invalid"; }
}

interface Candidate { encoded: string; memoryDir: string; guess: string | null }
interface Facts {
  repoDir: string; repoPresent: boolean; scriptsMissing: string[];
  configPath: string; config: DeviceConfig | null | "invalid"; known: string[];
  onDisk: Array<{ encoded: string; memoryDir: string }>;
  unmapped: Candidate[];          // on disk, not in mappings
  mappable: Candidate[];          // unmapped with a guess that is not already a mapping key — the only ones apply adds headlessly
}

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const repoDir = o.dir ?? pj(env.os, env.home, "projects", "claude-memory-sync");
  const f: Facts = { repoDir, repoPresent: await io.isDir(pj(env.os, repoDir, ".git")), scriptsMissing: [], configPath: pj(env.os, repoDir, "devices", `${env.label}.json`), config: null, known: [], onDisk: [], unmapped: [], mappable: [] };
  for (const s of HOOK_SCRIPTS) if (!(await io.exists(pj(env.os, env.claudeDir, "scripts", s)))) f.scriptsMissing.push(s);
  const projects = pj(env.os, env.claudeDir, "projects");
  for (const enc of (await io.readdir(projects)).sort()) {
    const memoryDir = pj(env.os, projects, enc, "memory");
    if (await io.isDir(memoryDir)) f.onDisk.push({ encoded: enc, memoryDir });
  }
  if (!f.repoPresent) return f;
  for (const n of (await io.readdir(pj(env.os, repoDir, "projects"))).sort()) if (!n.startsWith(".") && (await io.isDir(pj(env.os, repoDir, "projects", n)))) f.known.push(n);
  const raw = await readJson(io, f.configPath);
  f.config = raw === null || raw === "invalid" ? raw : (raw as DeviceConfig);
  const mappings = f.config && f.config !== "invalid" ? (f.config.mappings ?? {}) : {};
  const mapped = new Set(Object.values(mappings).map((v) => norm(String(v), env.os)));
  for (const d of f.onDisk) if (!mapped.has(norm(d.memoryDir, env.os))) f.unmapped.push({ ...d, guess: guessLogical(d.encoded, f.known) });
  f.mappable = f.unmapped.filter((u) => u.guess !== null && !(u.guess in mappings));
  return f;
}

const syncBin = (f: Facts, os: Os) => bashPath(pj(os, f.repoDir, "bin", "sync-memory"));

export const projectMemory: Artifact = {
  id: ID, surfaces: ["code"], portability: "portable", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.repoPresent) return { kind: "absent", details: [`${D.clone} — will clone to ${f.repoDir}`] };
    if (f.config === "invalid") return { kind: "blocked", reason: `devices/${ctx.env.label}.json is not valid JSON — fix it by hand, then re-run` };
    const details: string[] = [];
    if (f.config === null) details.push(`${D.config} '${ctx.env.label}' — will build devices/${ctx.env.label}.json`);
    else if (f.mappable.length) details.push(`${D.unmapped} ${f.mappable.map((u) => u.encoded).join(", ")} — will map into devices/${ctx.env.label}.json`);
    return details.length ? { kind: "drifted", details } : { kind: "present" };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const d = state.details ?? []; const steps: Step[] = [];
    if (d.some((x) => x.startsWith(D.clone))) steps.push(step("clone", "clone claude-memory-sync to ~/projects/claude-memory-sync"));
    steps.push(step("device-config", "build or extend devices/<label>.json from the memory dirs on this device"));
    steps.push(step("sync", "initial sync: sync-memory push, then pull"));
    return steps;
  },

  async apply(ctx, steps) {
    const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      switch (s.id) {
        case `${ID}.clone`: {
          const f = await facts(ctx);
          await io.mkdirp((env.os === "win32" ? path.win32 : path.posix).dirname(f.repoDir));
          const r = await io.exec("git", ["clone", "--quiet", await cloneUrl(io, o.sshUrl, o.httpsUrl), f.repoDir], { env: { GIT_TERMINAL_PROMPT: "0" } });
          if (r.code !== 0) throw new Error(`git clone failed: ${tail(r.stderr)}`);
          break;
        }
        case `${ID}.device-config`: {
          // bootstrap.sh step 6: a brand-new box has no ~/.claude/projects yet; an empty-mappings config is the correct fresh-box state.
          await io.mkdirp(pj(env.os, env.claudeDir, "projects"));
          await io.mkdirp(pj(env.os, env.claudeDir, "logs"));
          const f = await facts(ctx);
          if (f.config === "invalid") throw new Error(`devices/${env.label}.json is not valid JSON — fix it by hand, then re-run`);
          const fresh = f.config === null;
          const cfg: DeviceConfig = f.config ?? { device_label: env.label, platform: env.os, mappings: {} };
          const mappings: Record<string, string> = { ...(cfg.mappings ?? {}) };
          // A fresh config offers every dir (interactive users can name the unguessable ones); an existing one only gets what can be guessed.
          const candidates = fresh ? f.unmapped : f.mappable;
          let added = 0;
          for (const u of candidates) {
            const label = `encoded '${u.encoded}' → logical name (blank to skip)`;
            const logical = ctx.interactive ? (await ctx.prompt.text(label, u.guess ?? "")).trim() : (u.guess ?? "");
            if (!logical) { ctx.emit({ type: "note", level: "warn", message: `${ID}: skipped ${u.encoded} (no logical name)` }); continue; }
            if (logical in mappings) { ctx.emit({ type: "note", level: "warn", message: `${ID}: '${logical}' already maps to ${mappings[logical]} — not remapping to ${u.encoded}` }); continue; }
            mappings[logical] = fwd(u.memoryDir); added++;
          }
          if (!fresh && added === 0) break;
          await io.writeFile(f.configPath, JSON.stringify({ ...cfg, mappings }, null, 2) + "\n");
          ctx.emit({ type: "note", level: "info", message: `${ID}: ${fresh ? "wrote" : "extended"} devices/${env.label}.json (${added} mapping(s) added, ${Object.keys(mappings).length} total)` });
          break;
        }
        case `${ID}.sync`: {
          // Push FIRST: pull mirrors with --delete, and a box whose sync was dead-but-writing loses local-only memory to a pull-only start (2026-08-16).
          const f = await facts(ctx); const bin = syncBin(f, env.os);
          const push = await io.exec("bash", [bin, "--device", env.label, "push"], { timeout: 120_000 });
          if (push.code !== 0) ctx.emit({ type: "note", level: "warn", message: `${ID}: push exited ${push.code}${push.code === 3 ? " (conflicts — see <file>.conflict-<device> sidecars in the repo)" : ""}: ${tail(push.stderr)}` });
          const pull = await io.exec("bash", [bin, "--device", env.label, "pull"], { timeout: 120_000 });
          if (pull.code !== 0) throw new Error(`sync-memory pull failed (exit ${pull.code}): ${tail(pull.stderr)}`);
          break;
        }
        default: throw new Error(`unknown step ${s.id}`);
      }
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const { env, io } = ctx; const out: Check[] = [];
    if (!f.repoPresent) { out.push({ id: "repo", status: "error", message: `claude-memory-sync repo missing at ${f.repoDir} — run bs onboard` }); return out; }
    out.push({ id: "repo", status: "ok", message: "claude-memory-sync repo present" });
    out.push(f.scriptsMissing.length
      ? { id: "hook-scripts", status: "error", message: `hook script(s) missing from ~/.claude/scripts: ${f.scriptsMissing.join(", ")} — owned by dotclaude; check the claude-config artifact` }
      : { id: "hook-scripts", status: "ok", message: "hook scripts present in ~/.claude/scripts (owned by dotclaude)" });
    if (f.config === "invalid") { out.push({ id: "device-config", status: "error", message: `devices/${env.label}.json is not valid JSON — fix it by hand` }); return out; }
    if (f.config === null) { out.push({ id: "device-config", status: "error", message: `no device config for '${env.label}' — run bs onboard` }); return out; }
    out.push({ id: "device-config", status: "ok", message: `device config exists: devices/${env.label}.json` });
    const r = await io.exec("bash", [syncBin(f, env.os), "--device", env.label, "list"], { timeout: 30_000 });
    out.push(r.code === 0 ? { id: "resolves", status: "ok", message: "sync-memory list resolves this device's config" } : { id: "resolves", status: "error", message: "sync-memory list failed — device config unresolvable" });
    const mappedN = Object.keys(f.config.mappings ?? {}).length;
    const un = f.unmapped.map((u) => u.encoded);
    if (mappedN === 0 && un.length) out.push({ id: "coverage", status: "error", message: `device config maps NOTHING but memory dirs exist — sync is dead: ${un.join(" ")} — run bs onboard` });
    else if (un.length) out.push({ id: "coverage", status: "warn", message: `${mappedN} mapped; these memory dirs are NOT synced: ${un.join(" ")}` });
    else out.push({ id: "coverage", status: "ok", message: `all ${mappedN} memory dir(s) on this device are mapped` });
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx); const files: Bundle["files"] = [];
    if (!f.config || f.config === "invalid") return { files, instructions: [`no device config for '${ctx.env.label}' — memory not captured; run bs onboard first`] };
    for (const [logical, dir] of Object.entries(f.config.mappings ?? {})) {
      const local = String(dir);
      for (const rel of await walkFiles(ctx.io, ctx.env.os, local)) {
        const content = await ctx.io.readFile(pj(ctx.env.os, local, ...rel.split("/")));
        if (content !== null) files.push({ path: `memory/${logical}/${rel}`, content });
      }
    }
    return { files, instructions: [] };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/project-memory.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Register in the profile, extend the contract allowlist and the parity map**

`src/profiles/aca34.ts` — import `projectMemory`, append it to `artifacts` (after `gatewayLaunch`), and add options:
```ts
    "project-memory": { sshUrl: "git@github.com:merpuya/claude-memory-sync.git", httpsUrl: "https://github.com/merpuya/claude-memory-sync.git" },
```

`tests/unit/artifacts/contract.test.ts` — in `benignHandlers` add `io.on((c) => c === "bash", () => ({ code: 0, stdout: "", stderr: "" }));` and in `assertAllowedCall` add, before the final throw:
```ts
  if (cmd === "bash") { expect(args[0]).toMatch(/sync-memory$/); expect(args.at(-1)).toBe("list"); return; }
```

`tests/parity/normalize.ts` — append to `PARITY_MAP` (the bash doctor prints these only once step 6 has run on the box; on a box without the repo both sides emit only `repo`, and the map's other entries show as "not found" on both — that is a real parity failure to fix by running step 6, not a test bug):
```ts
  { id: "project-memory.repo", bash: /claude-memory-sync repo (?:present|missing)/ },
  { id: "project-memory.device-config", bash: /(?:device config exists: devices\/|no device config for)/ },
  { id: "project-memory.resolves", bash: /sync-memory list (?:resolves|failed)/ },
  { id: "project-memory.coverage", bash: /(?:memory dir\(s\) on this device are mapped|memory dirs are NOT synced|maps NOTHING but memory dirs exist)/ },
```

Run: `npm run typecheck && npm test && npm run test:parity`
Expected: all green. The live parity run on this mac should agree on the four new ids (this box: repo present, config exists, resolves, coverage **warn** — several memory dirs here are deliberately unmapped). If `bs doctor` says `warn` and bash says `warn`, parity holds.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/project-memory.ts src/profiles/aca34.ts tests/unit/artifacts/project-memory.test.ts tests/unit/artifacts/contract.test.ts tests/parity/normalize.ts
git commit -m "feat(artifacts): project-memory — port of claude-memory-sync/install.sh discovery, device config, push-then-pull, doctor coverage"
```

---

### Task 3: Artifact `mct` (bootstrap step 7 + doctor; token via config seed, never argv)

**Files:**
- Create: `src/artifacts/mct.ts`, `tests/unit/artifacts/mct.test.ts`
- Modify: `src/profiles/aca34.ts`, `tests/unit/artifacts/contract.test.ts`, `tests/parity/normalize.ts`

**Interfaces:**
- Consumes: `cloneUrl` (claude-config), `nodeVersion` (`src/artifacts/prereqs.ts`, exported), `defaultAccount` + `SecretRef` (`engine/secrets/store.ts`), `Prompter.text`.
- Options: `{ sshUrl: string; httpsUrl: string; syncUrl: string; deviceIds?: Record<string, string> }` — `deviceIds` maps a device **label** to its MeCP device slug (fleet convention since 2026-08-16: mct device id == MeCP device slug). A label absent from the map means the slug is asked for interactively and skipped headlessly.
- Produces: `export const mct: Artifact` (id `mct`, surfaces `["code"]`, `translatable`, requires `["prereqs", "secrets"]`); `export const CHECKOUT_PROBES`; `export const D`; `export async function npmArgv(io, os): Promise<[cmd: string, prefixArgs: string[]] | null>`.
- Step ids: `mct.clone`, `mct.build`, `mct.activate` (the last carries `secret: { service: "mct-sync-token", account }` and is `interactive` only when `deviceIds` lacks this label).

Severity ladder for `verify` (one check, id `status`) copied from the bash doctor: no checkout → **warn**; checkout without `dist/hooks/session-start.js` → **error** (the canonical hook fires and exits 0 silently — the outage shape); built but no `~/.mct/config.json` → **warn**; node < 22.5 → **warn**; else `mct doctor` exit 0 → ok, non-zero → **warn**.

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/mct.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mct, npmArgv } from "../../../src/artifacts/mct.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { sshUrl: "git@github.com:merpuya/me-count-token.git", httpsUrl: "https://github.com/merpuya/me-count-token.git", syncUrl: "https://mct.kearnsapuya.net" };
const DIR = "/h/projects/me-count-token";
const BUILT = `${DIR}/dist/hooks/session-start.js`;
const tools = { npm: "/usr/local/bin/npm", node: "/usr/local/bin/node" };

function fakes(io: FakeIo, o: { nodeVersion?: string; doctor?: number; onboard?: number; token?: boolean } = {}) {
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "successfully authenticated" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: `${o.nodeVersion ?? "v22.12.0"}\n`, stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "doctor", () => ({ code: o.doctor ?? 0, stdout: "", stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "onboard", () => ({ code: o.onboard ?? 0, stdout: "", stderr: "" }));
  io.on((c, a) => c === "git" && a[0] === "clone", () => { io.dirs.add(DIR); return { code: 0, stdout: "", stderr: "" }; });
  io.on((c, a) => c === "npm" && a.includes("build"), () => { io.files.set(BUILT, ""); io.dirs.add(`${DIR}/dist/hooks`); return { code: 0, stdout: "", stderr: "" }; });
  io.on((c) => c === "npm", () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "security", () => (o.token === false ? { code: 44, stdout: "", stderr: "" } : { code: 0, stdout: "t0k3n-value\n", stderr: "" }));
}

describe("mct", () => {
  it("fresh box, interactive: clone → build → activate by seeding ~/.mct/config.json and running a bare onboard; the token never hits argv or events", async () => {
    const { ctx, io, events } = await makeCtx({ opts, path: tools, env: { USER: "aca34", DEVICE_LABEL: "NEWBOX" }, interactive: true, answers: { "mct device id (MeCP device slug; blank to skip)": "newbox-slug" } });
    fakes(io);
    const s1 = await mct.detect(ctx);
    expect(s1).toEqual({ kind: "absent", details: [
      "no me-count-token checkout — will clone to ~/projects/me-count-token",
      "dist/ not built — will npm install && npm run build",
      "mct not activated — will seed ~/.mct/config.json from the store and run mct onboard",
    ] });
    const steps = mct.plan(ctx, s1);
    expect(steps.map((x) => [x.id, !!x.interactive])).toEqual([["mct.clone", false], ["mct.build", false], ["mct.activate", true]]);
    expect(steps[2].secret).toEqual({ service: "mct-sync-token", account: "aca34" });
    await mct.apply(ctx, steps);
    expect(io.calls.find((c) => c.cmd === "git")?.args).toEqual(["clone", "--quiet", opts.sshUrl, DIR]);
    expect(io.calls.filter((c) => c.cmd === "npm").map((c) => c.args)).toEqual([
      ["--prefix", DIR, "install", "--no-audit", "--no-fund", "--silent"], ["--prefix", DIR, "run", "--silent", "build"],
    ]);
    expect(JSON.parse(io.files.get("/h/.mct/config.json")!)).toEqual({ deviceId: "newbox-slug", syncUrl: opts.syncUrl, syncToken: "t0k3n-value" });
    expect(io.modes.get("/h/.mct/config.json")).toBe(0o600);
    expect(io.calls.find((c) => c.cmd === "node" && c.args[1] === "onboard")?.args).toEqual([`${DIR}/dist/cli.js`, "onboard"]);
    expect(JSON.stringify(io.calls.map((c) => c.args))).not.toContain("t0k3n-value");
    expect(JSON.stringify(events)).not.toContain("t0k3n-value");
    expect(await mct.detect(ctx)).toEqual({ kind: "present" });
    expect(mct.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("a label in deviceIds makes activation headless; an existing config's extra keys survive", async () => {
    const { ctx, io } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "box-slug" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "", "/h/.mct/config.json": "  " } });
    fakes(io);
    const s = await mct.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["mct not activated — will seed ~/.mct/config.json from the store and run mct onboard"] });
    const steps = mct.plan(ctx, s);
    expect(steps).toEqual([{ id: "mct.activate", title: "activate mct as 'box-slug' (token from the store) and run mct onboard", interactive: false, secret: { service: "mct-sync-token", account: "aca34" } }]);
    await mct.apply(ctx, steps);
    expect(JSON.parse(io.files.get("/h/.mct/config.json")!)).toEqual({ deviceId: "box-slug", syncUrl: opts.syncUrl, syncToken: "t0k3n-value" });
  });

  it("no sync token in the store: warn and skip activation without writing anything", async () => {
    const { ctx, io, events } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "box-slug" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "" } });
    fakes(io, { token: false });
    await mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }]);
    expect(io.writes).toEqual([]);
    expect(io.calls.find((c) => c.cmd === "node" && c.args[1] === "onboard")).toBeUndefined();
    expect(events).toContainEqual({ type: "note", level: "warn", message: "mct: no sync token — bs secrets set mct-sync-token (mint it with `mct devices add box-slug` on an admin box), then re-run" });
  });

  it("headless without a deviceIds entry: warn and skip; a blank interactive answer does the same", async () => {
    const { ctx, io, events } = await makeCtx({ opts, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "" } });
    fakes(io);
    await mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }]);
    expect(io.writes).toEqual([]);
    expect(events.find((e) => e.type === "note" && /no device id/.test(e.message))).toBeTruthy();
  });

  it("npm on Windows runs through node + npm-cli.js, never npm.cmd", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t", path: { npm: "C:\\Program Files\\nodejs\\npm.cmd" } });
    expect(await npmArgv(io, "win32")).toEqual(["node", ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"]]);
    expect(await npmArgv(new FakeIo({ path: { npm: "/usr/local/bin/npm" } }), "darwin")).toEqual(["npm", []]);
    expect(await npmArgv(new FakeIo(), "darwin")).toBeNull();
  });

  it("without npm the artifact is blocked, not failed", async () => {
    const { ctx } = await makeCtx({ opts, path: { node: "/usr/local/bin/node" }, env: { USER: "aca34" } });
    expect((await mct.detect(ctx)).kind).toBe("blocked");
  });

  it("verify walks the bootstrap doctor's ladder", async () => {
    const at = async (init: Parameters<typeof makeCtx>[0], f: Parameters<typeof fakes>[1] = {}) => { const { ctx, io } = await makeCtx({ opts, path: tools, env: { USER: "aca34" }, ...init }); fakes(io, f); return (await mct.verify(ctx))[0]; };
    expect(await at({})).toMatchObject({ id: "status", status: "warn", message: expect.stringMatching(/^no me-count-token checkout/) });
    expect(await at({ dirs: [DIR] })).toMatchObject({ status: "error", message: expect.stringMatching(/dist\/ not built/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "" } })).toMatchObject({ status: "warn", message: expect.stringMatching(/not activated/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } }, { nodeVersion: "v20.1.0" })).toMatchObject({ status: "warn", message: expect.stringMatching(/node v20\.1\.0 < 22\.5/) });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } })).toEqual({ id: "status", status: "ok", message: "mct doctor passes" });
    expect(await at({ dirs: [DIR], files: { [BUILT]: "", "/h/.mct/config.json": "{}" } }, { doctor: 1 })).toMatchObject({ status: "warn", message: expect.stringMatching(/mct doctor reports problems/) });
    expect(await at({ dirs: ["/h/Claude/me-count-token"], files: { "/h/Claude/me-count-token/dist/hooks/session-start.js": "", "/h/.mct/config.json": "{}" } })).toMatchObject({ status: "ok" });   // second probe path
  });

  it("an invalid ~/.mct/config.json fails activation with a clear message instead of clobbering it", async () => {
    const { ctx } = await makeCtx({ opts: { ...opts, deviceIds: { BOX: "s" } }, path: tools, env: { USER: "aca34", DEVICE_LABEL: "BOX" }, dirs: [DIR, `${DIR}/dist/hooks`], files: { [BUILT]: "", "/h/.mct/config.json": "{nope" } });
    await expect(mct.apply(ctx, [{ id: "mct.activate", title: "", secret: { service: "mct-sync-token", account: "aca34" } }])).rejects.toThrow(/not valid JSON/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/mct.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/mct.ts`**

```ts
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
          if (!nodeOk(f.node)) { ctx.emit({ type: "note", level: "warn", message: `mct: node ${f.node?.raw ?? "(missing)"} < 22.5 — hooks spool sidecars, but onboard needs node:sqlite; upgrade node and re-run` }); break; }
          const deviceId = o.deviceIds?.[env.label] ?? (ctx.interactive ? (await ctx.prompt.text("mct device id (MeCP device slug; blank to skip)", "")).trim() : "");
          if (!deviceId) { ctx.emit({ type: "note", level: "warn", message: "mct: no device id — activate later with bs onboard --only mct (interactive) or add deviceIds[<label>] to the profile" }); break; }
          if (!s.secret) throw new Error(`step ${s.id} carries no SecretRef`);
          const token = await ctx.secrets.get(s.secret);
          if (token === null) { ctx.emit({ type: "note", level: "warn", message: `mct: no sync token — bs secrets set mct-sync-token (mint it with \`mct devices add ${deviceId}\` on an admin box), then re-run` }); break; }
          let existing: Record<string, unknown> = {};
          const raw = await io.readFile(f.configPath);
          if (raw !== null && raw.trim()) { try { existing = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error(`${f.configPath} is not valid JSON — fix it by hand, then re-run`); } }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/mct.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Register in the profile, extend the contract allowlist and the parity map**

`src/profiles/aca34.ts` — import `mct`, append after `projectMemory`; add `"mct-sync-token"` to the `secrets.services` list; add options:
```ts
    // deviceIds: device label → MeCP device slug (fleet convention: mct device id == MeCP slug). Verified on JCB-AL-ACA34 from its ~/.mct/config.json;
    // JCB-AL-AV01 follows the slug in MeCP. A new box without an entry is asked interactively.
    mct: { sshUrl: "git@github.com:merpuya/me-count-token.git", httpsUrl: "https://github.com/merpuya/me-count-token.git", syncUrl: "https://mct.kearnsapuya.net",
      deviceIds: { "JCB-AL-ACA34": "macbook-aca34", "JCB-AL-AV01": "jcb-al-av01" } },
```

`tests/unit/artifacts/contract.test.ts` — `allTools` gains `npm: "/usr/local/bin/npm"`; `assertAllowedCall`'s `node` branch becomes:
```ts
  if (cmd === "node") { expect(args[0] === "--version" || (/dist[\\/]cli\.js$/.test(args[0]) && args[1] === "doctor")).toBe(true); return; }
```

`tests/parity/normalize.ts` — append:
```ts
  { id: "mct.status", bash: /(?:no me-count-token checkout|mct checkout present but dist\/ not built|mct built but not activated|mct activated but node|mct doctor (?:passes|reports problems))/ },
```

Run: `npm run typecheck && npm test && npm run test:parity`
Expected: green. On this mac the live parity should read `mct.status: ok` on both sides (activated, doctor passing); if mct's own doctor is unhappy today, both sides say `warn`.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/mct.ts src/profiles/aca34.ts tests/unit/artifacts/mct.test.ts tests/unit/artifacts/contract.test.ts tests/parity/normalize.ts
git commit -m "feat(artifacts): mct — clone/build at the hook-probe path, activate via config seed + bare onboard (token never on argv), doctor ladder"
```

---

### Task 4: Artifact `plugins` (marketplaces + plugin ids from the profile; v2 `installed_plugins.json`)

**Files:**
- Create: `src/artifacts/plugins.ts`, `tests/unit/artifacts/plugins.test.ts`
- Modify: `src/profiles/aca34.ts`

**Interfaces:**
- Consumes: `pj`, `Io`; no exec in `detect`/`verify` (state is read from `~/.claude/plugins/known_marketplaces.json`, `~/.claude/plugins/installed_plugins.json` `{version: 2, plugins: {"<name>@<marketplace>": [{scope, version, …}]}}`, and `settings.json` `enabledPlugins`).
- Options: `{ marketplaces: Array<{ name: string; source: string }>; plugins: string[] }` — `name` is the marketplace's own name (what `known_marketplaces.json` keys on; derived by Claude Code from the marketplace manifest, not chosen here); `source` is what `claude plugin marketplace add <source>` takes (`owner/repo`, URL, or path). Plugin ids are `name@marketplace`.
- Produces: `export const plugins: Artifact` (id `plugins`, surfaces `["code"]`, `translatable`, requires `["claude-config"]`); `export const D`; `export function sourceOf(m)`.
- Step ids: `plugins.marketplace.<name>`, `plugins.install.<id>`.

Rules: `claude` not on PATH → `blocked`. An installed plugin the user has **disabled** (`enabledPlugins[id] === false`) is never re-enabled (adopt-never-clobber) — `verify` reports it as `warn`. A failing `claude plugin install` throws with the stderr tail; the driver then skips the artifact's remaining steps (spec §7 "Apply failure"), so re-running `bs onboard` is the retry. Plugins whose marketplace declares an install command need `-y` when stdin is not a TTY; the CLI says so on stderr, which lands in the step's error — the user runs that one by hand.

- [ ] **Step 1: Write the failing test**

`tests/unit/artifacts/plugins.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { plugins, sourceOf } from "../../../src/artifacts/plugins.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const P = "/h/.claude/plugins";
const opts = {
  marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }, { name: "cornell-ai", source: "cu-aaii/claude-plugins-marketplace" }],
  plugins: ["superpowers@claude-plugins-official", "context7@claude-plugins-official"],
};
const NAME: Record<string, string> = { "anthropics/claude-plugins-official": "claude-plugins-official", "cu-aaii/claude-plugins-marketplace": "cornell-ai" };
const known = (names: string[]) => JSON.stringify(Object.fromEntries(names.map((n) => [n, { source: { source: "github", repo: Object.entries(NAME).find(([, v]) => v === n)![0] }, installLocation: `${P}/marketplaces/${n}` }])));
const installed = (ids: string[]) => JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: "user", installPath: `${P}/cache/x`, version: "6.3.0" }]])) });
const path = { claude: "/h/.local/bin/claude" };

/** `claude plugin …` fake that mutates the same JSON files the real CLI writes. */
function cliFake(io: FakeIo, failInstall?: string) {
  io.on((c, a) => c === "claude" && a[1] === "marketplace" && a[2] === "add", ({ args }) => {
    const cur = JSON.parse(io.files.get(`${P}/known_marketplaces.json`) ?? "{}");
    cur[NAME[args[3]]] = { source: { source: "github", repo: args[3] } };
    io.files.set(`${P}/known_marketplaces.json`, JSON.stringify(cur)); io.dirs.add(P);
    return { code: 0, stdout: "", stderr: "" };
  });
  io.on((c, a) => c === "claude" && a[1] === "install", ({ args }) => {
    if (args[2] === failInstall) return { code: 1, stdout: "", stderr: "Error: marketplace-declared install command needs -y\n" };
    const cur = JSON.parse(io.files.get(`${P}/installed_plugins.json`) ?? '{"version":2,"plugins":{}}');
    cur.plugins[args[2]] = [{ scope: "user", version: "1.0.0" }];
    io.files.set(`${P}/installed_plugins.json`, JSON.stringify(cur));
    return { code: 0, stdout: "", stderr: "" };
  });
}

describe("plugins", () => {
  it("fresh box: absent → add both marketplaces, install both plugins, then present; detect/plan never exec", async () => {
    const { ctx, io } = await makeCtx({ opts, path });
    cliFake(io);
    const s = await plugins.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [
      "marketplace absent: claude-plugins-official (anthropics/claude-plugins-official) — will add",
      "marketplace absent: cornell-ai (cu-aaii/claude-plugins-marketplace) — will add",
      "plugin absent: superpowers@claude-plugins-official — will install",
      "plugin absent: context7@claude-plugins-official — will install",
    ] });
    expect(io.calls).toEqual([]);
    const steps = plugins.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["plugins.marketplace.claude-plugins-official", "plugins.marketplace.cornell-ai", "plugins.install.superpowers@claude-plugins-official", "plugins.install.context7@claude-plugins-official"]);
    await plugins.apply(ctx, steps);
    expect(io.calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["claude", "plugin", "marketplace", "add", "anthropics/claude-plugins-official", "--scope", "user"],
      ["claude", "plugin", "marketplace", "add", "cu-aaii/claude-plugins-marketplace", "--scope", "user"],
      ["claude", "plugin", "install", "superpowers@claude-plugins-official", "--scope", "user"],
      ["claude", "plugin", "install", "context7@claude-plugins-official", "--scope", "user"],
    ]);
    expect(io.writes).toEqual([]);          // the CLI writes its own files; we never touch ~/.claude/plugins
    expect(await plugins.detect(ctx)).toEqual({ kind: "present" });
    expect(plugins.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("partially set up: drifted with only the missing marketplace and plugin", async () => {
    const { ctx } = await makeCtx({ opts, path, files: { [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]), [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official"]) } });
    const s = await plugins.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["marketplace absent: cornell-ai (cu-aaii/claude-plugins-marketplace) — will add", "plugin absent: context7@claude-plugins-official — will install"] });
    expect(plugins.plan(ctx, s).map((x) => x.id)).toEqual(["plugins.marketplace.cornell-ai", "plugins.install.context7@claude-plugins-official"]);
  });

  it("without the claude CLI the artifact is blocked", async () => {
    const { ctx } = await makeCtx({ opts });
    expect(await plugins.detect(ctx)).toEqual({ kind: "blocked", reason: "claude CLI not on PATH — install it (see prereqs), then re-run" });
    expect((await plugins.verify(ctx))[0]).toMatchObject({ id: "cli", status: "error" });
  });

  it("a failing install surfaces the stderr tail and stops", async () => {
    const { ctx, io } = await makeCtx({ opts, path, files: { [`${P}/known_marketplaces.json`]: known(["claude-plugins-official", "cornell-ai"]) } });
    cliFake(io, "superpowers@claude-plugins-official");
    await expect(plugins.apply(ctx, [{ id: "plugins.install.superpowers@claude-plugins-official", title: "" }])).rejects.toThrow(/claude plugin install superpowers@claude-plugins-official failed \(exit 1\): Error: marketplace-declared install command needs -y/);
  });

  it("verify: missing marketplace and plugin are errors, a disabled plugin is a warn that is never auto-enabled", async () => {
    const { ctx } = await makeCtx({ opts, path, files: {
      [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]),
      [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official"]),
      "/h/.claude/settings.json": JSON.stringify({ enabledPlugins: { "superpowers@claude-plugins-official": false } }),
    } });
    expect((await plugins.verify(ctx)).map((c) => [c.id, c.status])).toEqual([
      ["cli", "ok"], ["marketplace.claude-plugins-official", "ok"], ["marketplace.cornell-ai", "error"],
      ["plugin.superpowers@claude-plugins-official", "warn"], ["plugin.context7@claude-plugins-official", "error"],
    ]);
    expect(await plugins.detect(ctx)).toMatchObject({ kind: "drifted" });
    expect(plugins.plan(ctx, await plugins.detect(ctx)).map((s) => s.id)).not.toContain("plugins.install.superpowers@claude-plugins-official");
  });

  it("capture writes plugins.json from what is on the box (every marketplace and plugin, with enabled state)", async () => {
    const { ctx } = await makeCtx({ opts, path, files: {
      [`${P}/known_marketplaces.json`]: known(["claude-plugins-official"]),
      [`${P}/installed_plugins.json`]: installed(["superpowers@claude-plugins-official", "extra@claude-plugins-official"]),
      "/h/.claude/settings.json": JSON.stringify({ enabledPlugins: { "extra@claude-plugins-official": false } }),
    } });
    const b = await plugins.capture!(ctx);
    expect(b.files.map((f) => f.path)).toEqual(["plugins.json"]);
    expect(JSON.parse(b.files[0].content)).toEqual({
      marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official" }],
      plugins: [{ id: "superpowers@claude-plugins-official", version: "6.3.0", scope: "user", enabled: true }, { id: "extra@claude-plugins-official", version: "6.3.0", scope: "user", enabled: false }],
    });
    expect(sourceOf({ source: { source: "directory", path: "/x/y" } })).toBe("/x/y");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/artifacts/plugins.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/artifacts/plugins.ts`**

```ts
import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { pj } from "../engine/env.ts";
import type { Io } from "../engine/io.ts";

const ID = "plugins";
export interface Marketplace { name: string; source: string }
interface Opts { marketplaces: Marketplace[]; plugins: string[] }
export const D = { marketplace: "marketplace absent:", plugin: "plugin absent:" } as const;
const tail = (s: string) => s.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");

type KnownMarketplaces = Record<string, { source?: Record<string, unknown>; installLocation?: string }>;
interface InstalledPlugins { version?: number; plugins?: Record<string, Array<{ scope?: string; version?: string; installPath?: string }>> }

/** What `claude plugin marketplace add` would take to recreate a known marketplace. */
export function sourceOf(m: { source?: Record<string, unknown> }): string {
  const s = m.source ?? {};
  return String(s.repo ?? s.url ?? s.path ?? JSON.stringify(s));
}

async function readJson<T>(io: Io, p: string): Promise<T | null> {
  const s = await io.readFile(p);
  if (s === null) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

interface Facts { cli: boolean; dirExists: boolean; known: KnownMarketplaces; installed: NonNullable<InstalledPlugins["plugins"]>; enabled: Record<string, boolean>; missingMarkets: Marketplace[]; missingPlugins: string[] }

async function facts(ctx: Ctx): Promise<Facts> {
  const { io, env } = ctx; const o = ctx.opts as unknown as Opts;
  const dir = pj(env.os, env.claudeDir, "plugins");
  const known = (await readJson<KnownMarketplaces>(io, pj(env.os, dir, "known_marketplaces.json"))) ?? {};
  const installed = (await readJson<InstalledPlugins>(io, pj(env.os, dir, "installed_plugins.json")))?.plugins ?? {};
  const enabled = (await readJson<{ enabledPlugins?: Record<string, boolean> }>(io, pj(env.os, env.claudeDir, "settings.json")))?.enabledPlugins ?? {};
  return {
    cli: (await io.which("claude")) !== null, dirExists: await io.isDir(dir), known, installed, enabled,
    missingMarkets: (o.marketplaces ?? []).filter((m) => !(m.name in known)),
    missingPlugins: (o.plugins ?? []).filter((p) => !(p in installed)),
  };
}

const claude = (io: Io, args: string[]) => io.exec("claude", ["plugin", ...args], { timeout: 300_000 });

export const plugins: Artifact = {
  id: ID, surfaces: ["code"], portability: "translatable", requires: ["claude-config"],

  async detect(ctx): Promise<State> {
    const f = await facts(ctx);
    if (!f.cli) return { kind: "blocked", reason: "claude CLI not on PATH — install it (see prereqs), then re-run" };
    const details = [
      ...f.missingMarkets.map((m) => `${D.marketplace} ${m.name} (${m.source}) — will add`),
      ...f.missingPlugins.map((p) => `${D.plugin} ${p} — will install`),
    ];
    if (!details.length) return { kind: "present" };
    return f.dirExists ? { kind: "drifted", details } : { kind: "absent", details };
  },

  plan(_ctx, state) {
    if (state.kind === "present" || state.kind === "blocked") return [];
    const steps: Step[] = [];
    for (const d of state.details ?? []) {
      if (d.startsWith(D.marketplace)) { const name = d.slice(D.marketplace.length).trim().split(" ")[0]; steps.push({ id: `${ID}.marketplace.${name}`, title: `add marketplace ${name}` }); }
      else if (d.startsWith(D.plugin)) { const id = d.slice(D.plugin.length).trim().split(" ")[0]; steps.push({ id: `${ID}.install.${id}`, title: `claude plugin install ${id}` }); }
    }
    return steps;
  },

  async apply(ctx, steps) {
    const o = ctx.opts as unknown as Opts;
    for (const s of steps) {
      if (s.id.startsWith(`${ID}.marketplace.`)) {
        const name = s.id.slice(`${ID}.marketplace.`.length);
        const m = (o.marketplaces ?? []).find((x) => x.name === name);
        if (!m) throw new Error(`marketplace ${name} is not in the profile`);
        const r = await claude(ctx.io, ["marketplace", "add", m.source, "--scope", "user"]);
        if (r.code !== 0) throw new Error(`claude plugin marketplace add ${m.source} failed (exit ${r.code}): ${tail(r.stderr)}`);
      } else if (s.id.startsWith(`${ID}.install.`)) {
        const id = s.id.slice(`${ID}.install.`.length);
        const r = await claude(ctx.io, ["install", id, "--scope", "user"]);
        if (r.code !== 0) throw new Error(`claude plugin install ${id} failed (exit ${r.code}): ${tail(r.stderr)}`);
      } else throw new Error(`unknown step ${s.id}`);
    }
  },

  async verify(ctx): Promise<Check[]> {
    const f = await facts(ctx); const o = ctx.opts as unknown as Opts; const out: Check[] = [];
    if (!f.cli) { out.push({ id: "cli", status: "error", message: "claude CLI not on PATH — plugins cannot be verified or installed" }); return out; }
    out.push({ id: "cli", status: "ok", message: "claude CLI on PATH" });
    for (const m of o.marketplaces ?? []) out.push(m.name in f.known
      ? { id: `marketplace.${m.name}`, status: "ok", message: `marketplace ${m.name} (${sourceOf(f.known[m.name])})` }
      : { id: `marketplace.${m.name}`, status: "error", message: `marketplace ${m.name} missing — run bs onboard` });
    for (const p of o.plugins ?? []) {
      if (!(p in f.installed)) out.push({ id: `plugin.${p}`, status: "error", message: `plugin ${p} not installed — run bs onboard` });
      else if (f.enabled[p] === false) out.push({ id: `plugin.${p}`, status: "warn", message: `plugin ${p} installed but disabled — claude plugin enable ${p} (left as you set it)` });
      else out.push({ id: `plugin.${p}`, status: "ok", message: `plugin ${p} ${f.installed[p][0]?.version ?? ""}`.trimEnd() });
    }
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    const f = await facts(ctx);
    const doc = {
      marketplaces: Object.entries(f.known).map(([name, m]) => ({ name, source: sourceOf(m) })),
      plugins: Object.entries(f.installed).flatMap(([id, entries]) => entries.map((e) => ({ id, version: e.version ?? null, scope: e.scope ?? "user", enabled: f.enabled[id] !== false }))),
    };
    return { files: [{ path: "plugins.json", content: JSON.stringify(doc, null, 2) + "\n" }], instructions: [] };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/artifacts/plugins.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Register in the profile**

`src/profiles/aca34.ts` — import `plugins`, append after `mct`, and add options (the set enabled on JCB-AL-ACA34 on 2026-09-10; plugins the owner keeps disabled — `github`, `firecrawl`, `microsoft-docs`, `plugin-dev`, `supabase`, `vercel`, `learning-output-style` — are deliberately not listed):
```ts
    plugins: {
      marketplaces: [
        { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
        { name: "cornell-ai", source: "cu-aaii/claude-plugins-marketplace" },
      ],
      plugins: [
        "superpowers@claude-plugins-official", "context7@claude-plugins-official", "code-review@claude-plugins-official", "code-simplifier@claude-plugins-official",
        "commit-commands@claude-plugins-official", "feature-dev@claude-plugins-official", "frontend-design@claude-plugins-official", "mcp-server-dev@claude-plugins-official",
        "claude-code-setup@claude-plugins-official", "claude-md-management@claude-plugins-official", "explanatory-output-style@claude-plugins-official",
        "notion@claude-plugins-official", "playwright@claude-plugins-official", "ralph-loop@claude-plugins-official", "remember@claude-plugins-official",
        "security-guidance@claude-plugins-official", "skill-creator@claude-plugins-official",
        "pyright-lsp@claude-plugins-official", "swift-lsp@claude-plugins-official", "typescript-lsp@claude-plugins-official",
      ],
    },
```
The contract test needs no allowlist change (no exec in detect/verify). Run: `npm run typecheck && npm test` — expected green; the contract test now covers seven artifacts.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/plugins.ts src/profiles/aca34.ts tests/unit/artifacts/plugins.test.ts
git commit -m "feat(artifacts): plugins — restore marketplaces + plugin ids from the profile via the claude CLI; disabled plugins are never re-enabled"
```

---

### Task 5: Capture driver — `engine/capture.ts` (manifest, refusal rules, secret scan)

**Files:**
- Create: `src/engine/capture.ts`, `tests/unit/engine/capture.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `BundleFile`, `Portability`, `withOpts` (Task 1), `selectArtifacts` (`engine/plan.ts`), `Env`, `Profile`.
- Produces:
  - `interface ManifestArtifact { id: string; portability: Portability; files: string[]; sha256: Record<string, string> }`
  - `interface Manifest { schema: 1; source: Env; captured_at: string; artifacts: ManifestArtifact[] }`
  - `interface CaptureResult { manifest: Manifest; files: BundleFile[]; instructions: string }`
  - `interface SecretHit { path: string; line: number; pattern: string }`; `class SecretScanError extends Error { hits: SecretHit[] }`
  - `SECRET_PATTERNS`, `scanForSecrets(files): SecretHit[]`, `sha256(s): string`, `captureBundle(profile, ctx, now?): Promise<CaptureResult>`.

Rules (spec §5): artifacts are visited in DAG order; only those with `capture`; a `device-bound` / `non-transferable` artifact returning files throws; paths must be relative posix without `..`, and unique across artifacts; the scan runs over every collected file before anything is returned; `instructions` is the rendered `instructions.md`. The four scan patterns were checked against the 450 tracked dotclaude files on 2026-09-10 — zero hits (the `Bearer ${…}` placeholders are excluded by the lookahead).

- [ ] **Step 1: Write the failing test**

`tests/unit/engine/capture.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { captureBundle, scanForSecrets, SecretScanError, sha256 } from "../../../src/engine/capture.ts";
import type { Profile } from "../../../src/engine/profile.ts";
import { makeCtx } from "../helpers.ts";

const art = (id: string, portability: Artifact["portability"], bundle: { files?: Array<{ path: string; content: string }>; instructions?: string[] } | null, seen?: unknown[]): Artifact => ({
  id, portability, surfaces: ["code"], requires: [],
  detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [],
  ...(bundle ? { capture: async (c) => { seen?.push(c.opts); return { files: bundle.files ?? [], instructions: bundle.instructions ?? [] }; } } : {}),
});
const profile = (artifacts: Artifact[], options: Profile["options"] = {}): Profile => ({ name: "t", provider: "gateway", surfaces: ["code"], artifacts, options });

describe("scanForSecrets", () => {
  it("flags key-shaped strings with file and line; ignores ${…} placeholders and short ids", () => {
    const hits = scanForSecrets([
      { path: "a.txt", content: "ok\nsk-ant-api03-abcdefghijklmnop\n" },
      { path: "b.json", content: '{"Authorization":"Bearer ${MECP_DEVICE_TOKEN}"}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123\n' },
      { path: "c.md", content: "commit 3ea32df27be7 and " + "0".repeat(64) + "\n" },
      { path: "d.md", content: "ghp_" + "A".repeat(36) + "\n" },
    ]);
    expect(hits).toEqual([
      { path: "a.txt", line: 2, pattern: "anthropic-key" }, { path: "b.json", line: 2, pattern: "bearer" },
      { path: "c.md", line: 1, pattern: "hex-64" }, { path: "d.md", line: 1, pattern: "github-token" },
    ]);
  });
});

describe("captureBundle", () => {
  it("collects files + instructions in DAG order, hashes a manifest, passes each artifact its options, notes per artifact", async () => {
    const { ctx, events } = await makeCtx({ env: { DEVICE_LABEL: "BOX" } });
    const seen: unknown[] = [];
    const p = profile([
      art("cfg", "portable", { files: [{ path: "claude-config/CLAUDE.md", content: "hi\n" }] }, seen),
      art("keys", "device-bound", { instructions: ["bs secrets set x"] }),
      art("silent", "translatable", null),
    ], { cfg: { k: 1 } });
    const res = await captureBundle(p, ctx, new Date("2026-09-10T12:00:00Z"));
    expect(res.files).toEqual([{ path: "claude-config/CLAUDE.md", content: "hi\n" }]);
    expect(res.manifest).toEqual({ schema: 1, source: ctx.env, captured_at: "2026-09-10T12:00:00.000Z", artifacts: [
      { id: "cfg", portability: "portable", files: ["claude-config/CLAUDE.md"], sha256: { "claude-config/CLAUDE.md": sha256("hi\n") } },
      { id: "keys", portability: "device-bound", files: [], sha256: {} },
    ] });
    expect(res.instructions.startsWith("# boot-slapper — manual steps for BOX")).toBe(true);
    expect(res.instructions).toContain("## keys (device-bound)\n\n- bs secrets set x\n");
    expect(seen).toEqual([{ k: 1 }]);
    expect(events.map((e) => (e.type === "note" ? e.message : ""))).toEqual(["captured cfg: 1 file(s)", "captured keys: 0 file(s), 1 instruction(s)"]);
  });

  it("refuses files from device-bound artifacts, unsafe or duplicate paths, and secret-shaped content", async () => {
    const { ctx } = await makeCtx();
    await expect(captureBundle(profile([art("k", "device-bound", { files: [{ path: "x", content: "" }] })]), ctx)).rejects.toThrow(/k is device-bound and returned 1 file/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "../x", content: "" }] })]), ctx)).rejects.toThrow(/relative posix/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "/abs", content: "" }] })]), ctx)).rejects.toThrow(/relative posix/);
    await expect(captureBundle(profile([art("a", "portable", { files: [{ path: "x", content: "" }] }), art("b", "portable", { files: [{ path: "x", content: "" }] })]), ctx)).rejects.toThrow(/duplicate bundle path x/);
    const err = await captureBundle(profile([art("a", "portable", { files: [{ path: "n/t.txt", content: "line\nsk-ant-abcdefghijklmnopqrstu\n" }] })]), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretScanError);
    expect((err as SecretScanError).hits).toEqual([{ path: "n/t.txt", line: 2, pattern: "anthropic-key" }]);
    expect((err as SecretScanError).message).toBe("refusing to write the bundle: 1 secret-shaped string(s) — n/t.txt:2 (anthropic-key)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/engine/capture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/capture.ts`**

```ts
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
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "anthropic-key", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/ },
  { name: "bearer", re: /\bBearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{16,}/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "hex-64", re: /\b[0-9a-f]{64}\b/ },            // mct sync tokens and most hashed-secret shapes
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
    for (const p of SECRET_PATTERNS) if (p.re.test(line)) hits.push({ path: f.path, line: i + 1, pattern: p.name });
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/engine/capture.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/capture.ts tests/unit/engine/capture.test.ts
git commit -m "feat(engine): capture driver — manifest with sha256, device-bound file refusal, secret scan that refuses the whole bundle"
```

---

### Task 6: `capture` on the existing artifacts + `bs capture --out <dir>`

**Files:**
- Modify: `src/artifacts/claude-config.ts`, `src/artifacts/secrets.ts`, `src/artifacts/prereqs.ts`, `src/cli.ts`, `tests/unit/artifacts/claude-config.test.ts`, `tests/unit/artifacts/contract.test.ts`, `tests/unit/cli.test.ts`

**Interfaces:**
- Consumes: `captureBundle`, `SecretScanError`, `CaptureResult` (Task 5); `isCheckout` + the file-local `git()` helper in claude-config; `SECRET_LABELS` + `refs()` in secrets; `CLAUDE_HINT` in prereqs.
- Produces: `claudeConfig.capture` (tracked files via `git ls-files -z` → `claude-config/<rel>`); `secrets.capture` and `prereqs.capture` (instructions only); `mct.capture` and `projectMemory.capture` / `plugins.capture` already exist (Tasks 2–4). CLI: `bs capture --out <dir> [--profile aca34]` — exit 0 on a written bundle, 1 on a secret hit or an existing bundle at `--out`, 2 on usage.

Known limitation (record in README): bundle contents are read as UTF-8 text; dotclaude tracks no binaries today (checked 2026-09-10), and `capture` would mangle one — extend `Io.readFile` to bytes when that changes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/artifacts/claude-config.test.ts` (register the `ls-files` handler **before** `gitFake`, whose catch-all `git` handler would swallow it):
```ts
  it("capture bundles exactly the tracked files under claude-config/ and never writes", async () => {
    const { ctx, io } = await makeCtx({ opts, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "rules\n", "/h/.claude/scripts/x.mjs": "js\n", "/h/.claude/untracked.txt": "no\n" } });
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "CLAUDE.md\0scripts/x.mjs\0deleted.md\0", stderr: "" }));
    gitFake(io, { checkout: true });
    const b = await claudeConfig.capture!(ctx);
    expect(b.files).toEqual([{ path: "claude-config/CLAUDE.md", content: "rules\n" }, { path: "claude-config/scripts/x.mjs", content: "js\n" }]);
    expect(io.writes).toEqual([]);
    const { ctx: plain, io: io2 } = await makeCtx({ opts, dirs: ["/h/.claude"] });
    gitFake(io2, { checkout: false });
    expect((await claudeConfig.capture!(plain)).files).toEqual([]);
  });
```

Append to `tests/unit/artifacts/contract.test.ts`:
```ts
  it("capture never writes, and device-bound / non-transferable artifacts capture no files", async () => {
    for (const artifact of aca34.artifacts) {
      if (!artifact.capture) continue;
      const { ctx, io } = await makeCtx({ path: allTools, dirs: ["/h/.claude"], env: { USER: "aca34" }, opts: aca34.options[artifact.id] ?? {} });
      benignHandlers(io);
      const b = await artifact.capture(withOpts(ctx, aca34.options[artifact.id]));
      expect(io.writes, artifact.id).toEqual([]);
      if (artifact.portability === "device-bound" || artifact.portability === "non-transferable") expect(b.files, artifact.id).toEqual([]);
    }
  });
```

Append to `tests/unit/cli.test.ts`:
```ts
  it("capture --out writes the bundle (files, instructions.md, manifest.json last) and refuses to overwrite a bundle", async () => {
    const out = sink();
    const io = new FakeIo({ env: { USER: "aca34" }, dirs: ["/h/.claude"], files: { "/h/.claude/CLAUDE.md": "rules\n", "/h/.claude/plugins/known_marketplaces.json": "{}", "/h/.claude/plugins/installed_plugins.json": '{"version":2,"plugins":{}}' } });
    io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "CLAUDE.md\0", stderr: "" }));
    io.on(() => true, () => ({ code: 1, stdout: "", stderr: "" }));
    expect(await main(["capture", "--out", "/tmp/b"], { io, stdout: out, stderr: sink() })).toBe(0);
    expect(io.writes).toEqual(["/tmp/b/claude-config/CLAUDE.md", "/tmp/b/plugins.json", "/tmp/b/instructions.md", "/tmp/b/manifest.json"]);
    const m = JSON.parse(io.files.get("/tmp/b/manifest.json")!);
    expect(m.schema).toBe(1);
    expect(m.artifacts.map((a: { id: string }) => a.id)).toEqual(["prereqs", "claude-config", "secrets", "project-memory", "plugins", "mct"]);   // DAG order; gateway-launch has no capture
    expect(io.files.get("/tmp/b/instructions.md")).toMatch(/## secrets \(device-bound\)/);
    expect(out.lines.at(-1)).toBe("==> bundle written: /tmp/b (2 file(s), 6 artifact(s))");
    const err = sink();
    expect(await main(["capture", "--out", "/tmp/b"], { io, stdout: sink(), stderr: err })).toBe(1);
    expect(err.lines[0]).toMatch(/already holds a bundle/);
    expect(await main(["capture"], { io, stdout: sink(), stderr: sink() })).toBe(2);
  });
  it("capture refuses the whole bundle on a secret-shaped string and writes nothing", async () => {
    const io = new FakeIo({ env: { USER: "aca34" }, dirs: ["/h/.claude"], files: { "/h/.claude/notes.md": "token sk-ant-abcdefghijklmnopqrstuv\n" } });
    io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
    io.on((c, a) => c === "git" && a.includes("ls-files"), () => ({ code: 0, stdout: "notes.md\0", stderr: "" }));
    io.on(() => true, () => ({ code: 1, stdout: "", stderr: "" }));
    const err = sink();
    expect(await main(["capture", "--out", "/tmp/c"], { io, stdout: sink(), stderr: err })).toBe(1);
    expect(err.lines[0]).toBe("refusing to write the bundle: 1 secret-shaped string(s) — claude-config/notes.md:1 (anthropic-key)");
    expect(io.writes).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/artifacts/claude-config.test.ts tests/unit/artifacts/contract.test.ts tests/unit/cli.test.ts`
Expected: FAIL — `capture` undefined on claude-config; the CLI treats `capture` as an unknown command (exit 2).

- [ ] **Step 3: Implement**

`src/artifacts/claude-config.ts` — add `Bundle` to the type import and this method to `claudeConfig`:
```ts
  async capture(ctx): Promise<Bundle> {
    const { io, env } = ctx; const dir = env.claudeDir;
    if (!(await isCheckout(io, dir))) return { files: [], instructions: ["~/.claude is not a dotclaude checkout — nothing captured; the target clones dotclaude itself (bs onboard)"] };
    const ls = await git(io, dir, ["ls-files", "-z"]);
    if (ls.code !== 0) throw new Error(`git ls-files failed: ${ls.stderr.trim()}`);
    const files: Bundle["files"] = [];
    for (const rel of ls.stdout.split("\0").filter(Boolean)) {
      const content = await io.readFile(pj(env.os, dir, ...rel.split("/")));
      if (content !== null) files.push({ path: `claude-config/${rel}`, content });     // a tracked-but-deleted file is simply not bundled
    }
    return { files, instructions: [] };
  },
```

`src/artifacts/secrets.ts` — add `Bundle` to the import and:
```ts
  async capture(ctx): Promise<Bundle> {
    return { files: [], instructions: refs(ctx).map((r) => `bs secrets set ${r.service} — ${SECRET_LABELS[r.service]}`) };
  },
```

`src/artifacts/prereqs.ts` — add `Bundle` to the import and:
```ts
  async capture(): Promise<Bundle> {
    return { files: [], instructions: [
      "git, curl, jq, python3 (or python) and node ≥ 22.5 on PATH — platform package manager (dotfiles Brewfile / winget-packages.json)",
      `claude CLI — ${CLAUDE_HINT}`,
      "Claude Desktop — https://claude.com/download (needed by the Phase 3 desktop artifacts)",
    ] };
  },
```

`src/cli.ts` — imports, usage, option, and the command:
```ts
import { captureBundle, SecretScanError, type CaptureResult } from "./engine/capture.ts";
// USAGE gains:   bs capture --out <dir> [--profile aca34]
// parseArgs options gain:  out: { type: "string" },
    case "capture": {
      const out = typeof values.out === "string" ? values.out : "";
      if (!out) { stderr.write("bs capture needs --out <dir>"); stderr.write(USAGE); return 2; }
      const os = toOs(io.platform);
      if (await io.exists(pj(os, out, "manifest.json"))) { stderr.write(`${out} already holds a bundle (manifest.json) — choose another --out`); return 1; }
      const ctx = await buildCtx(io, profile, false, headlessReporter(stdout));
      let res: CaptureResult;
      try { res = await captureBundle(profile, ctx); }
      catch (e) { if (e instanceof SecretScanError) { stderr.write(e.message); return 1; } throw e; }
      for (const f of res.files) await io.writeFile(pj(os, out, ...f.path.split("/")), f.content);
      await io.writeFile(pj(os, out, "instructions.md"), res.instructions);
      await io.writeFile(pj(os, out, "manifest.json"), JSON.stringify(res.manifest, null, 2) + "\n");   // last: a manifest means "complete"
      stdout.write(`==> bundle written: ${out} (${res.files.length} file(s), ${res.manifest.artifacts.length} artifact(s))`);
      return 0;
    }
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/claude-config.ts src/artifacts/secrets.ts src/artifacts/prereqs.ts src/cli.ts tests/unit/artifacts/claude-config.test.ts tests/unit/artifacts/contract.test.ts tests/unit/cli.test.ts
git commit -m "feat(cli): bs capture --out <dir> — tracked dotclaude files, plugins.json, memory tree, instructions.md, manifest last"
```

---

### Task 7: TUI view-model and Prompter bridge (pure TypeScript, no Ink)

**Files:**
- Create: `src/ui/tui/model.ts`, `src/ui/tui/prompter.ts`, `tests/unit/ui/model.test.ts`, `tests/unit/ui/prompter.test.ts`

**Interfaces:**
- Consumes: `EngineEvent`, `Plan`, `State`, `Step`, `Check`, `Portability`, `Prompter`.
- Produces (`model.ts`):
  - `type Phase = "planning" | "confirm" | "applying" | "verifying" | "done" | "aborted"`
  - `interface StepRow { id; title; interactive: boolean; status: "pending" | "running" | "ok" | "failed" | "skipped"; error?: string }`
  - `interface ArtifactRow { id; portability: Portability | null; state: State | null; steps: StepRow[]; skipped?: string; checks: Check[] }`
  - `interface Model { phase: Phase; rows: ArtifactRow[]; notes: Note[]; exitCode: number | null }`
  - `type Action = EngineEvent | { type: "plan:resolved"; plan: Plan } | { type: "artifacts"; list: Array<{ id: string; portability: Portability }> } | { type: "phase"; phase: Phase } | { type: "exit"; code: number }`
  - `initialModel(): Model`, `reduce(m: Model, a: Action): Model` (pure, returns a new object), `stateLabel(s: State | null): string`, `summary(rows): { ok; warn; error }`
- Produces (`prompter.ts`): `interface Pending { kind: "secret" | "text" | "confirm" | "gate"; label: string; fallback?: string; submit(value: string): void }`; `bridgePrompter(onPending: (p: Pending | null) => void): Prompter` — each call surfaces a `Pending`; `submit` clears it (`onPending(null)`) and settles the promise.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ui/model.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Plan } from "../../../src/engine/plan.ts";
import { initialModel, reduce, stateLabel, summary, type Action, type Model } from "../../../src/ui/tui/model.ts";

const plan = [{ artifact: { id: "a", portability: "portable" }, state: { kind: "absent" }, steps: [{ id: "a.1", title: "one" }, { id: "a.2", title: "two", interactive: true }], opts: {} }] as unknown as Plan;
const run = (actions: Action[], m: Model = initialModel()) => actions.reduce(reduce, m);

describe("tui model", () => {
  it("plan:resolved seeds rows with pending steps; step events move them along; a skip marks the rest", () => {
    let m = run([{ type: "plan:resolved", plan }]);
    expect(m.rows[0]).toMatchObject({ id: "a", portability: "portable", state: { kind: "absent" }, steps: [{ id: "a.1", status: "pending", interactive: false }, { id: "a.2", status: "pending", interactive: true }] });
    m = run([{ type: "step:start", artifact: "a", step: plan[0].steps[0] }, { type: "step:done", artifact: "a", step: plan[0].steps[0], ok: true }], m);
    expect(m.rows[0].steps.map((s) => s.status)).toEqual(["ok", "pending"]);
    m = run([{ type: "artifact:skipped", id: "a", reason: "needs a tty" }], m);
    expect(m.rows[0]).toMatchObject({ skipped: "needs a tty", steps: [{ status: "ok" }, { status: "skipped" }] });
  });
  it("a failed step keeps its error; checks and notes accumulate; unknown artifacts are upserted; summary counts", () => {
    const m = run([
      { type: "plan:resolved", plan },
      { type: "step:done", artifact: "a", step: plan[0].steps[0], ok: false, error: "boom" },
      { type: "check:result", artifact: "a", check: { id: "x", status: "error", message: "bad" } },
      { type: "check:result", artifact: "b", check: { id: "y", status: "warn", message: "meh" } },
      { type: "note", level: "warn", message: "careful" },
    ]);
    expect(m.rows[0].steps[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(m.rows.map((r) => [r.id, r.portability])).toEqual([["a", "portable"], ["b", null]]);
    expect(summary(m.rows)).toEqual({ ok: 0, warn: 1, error: 1 });
    expect(m.notes).toEqual([{ level: "warn", message: "careful" }]);
  });
  it("artifacts/phase/exit actions and stateLabel", () => {
    const m = run([{ type: "artifacts", list: [{ id: "p", portability: "device-bound" }] }, { type: "phase", phase: "verifying" }, { type: "exit", code: 1 }]);
    expect(m).toMatchObject({ phase: "done", exitCode: 1, rows: [{ id: "p", portability: "device-bound", checks: [] }] });
    expect(run([{ type: "phase", phase: "aborted" }, { type: "exit", code: 3 }])).toMatchObject({ phase: "aborted", exitCode: 3 });
    expect(stateLabel(null)).toBe("…");
    expect(stateLabel({ kind: "present" })).toBe("present");
    expect(stateLabel({ kind: "drifted", details: ["a", "b"] })).toBe("drifted — a; b");
    expect(stateLabel({ kind: "blocked", reason: "no node" })).toBe("blocked — no node");
  });
});
```

`tests/unit/ui/prompter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { bridgePrompter, type Pending } from "../../../src/ui/tui/prompter.ts";

describe("bridgePrompter", () => {
  it("surfaces each call as a Pending, settles on submit, clears afterwards", async () => {
    const box: { last: Pending | null; nulls: number } = { last: null, nulls: 0 };
    const p = bridgePrompter((x) => { if (x) box.last = x; else box.nulls++; });
    const secret = p.secret("Paste key");
    expect(box.last).toMatchObject({ kind: "secret", label: "Paste key" });
    box.last!.submit("s3cr3t");
    expect(await secret).toBe("s3cr3t");
    const yes = p.confirm("Apply?"); box.last!.submit("Y"); expect(await yes).toBe(true);
    const no = p.confirm("Apply?"); box.last!.submit(""); expect(await no).toBe(false);
    const text = p.text("name", "guess"); expect(box.last).toMatchObject({ kind: "text", fallback: "guess" }); box.last!.submit("  "); expect(await text).toBe("guess");
    const typed = p.text("name", "guess"); box.last!.submit("mine"); expect(await typed).toBe("mine");
    const gate = p.gate("done?"); expect(box.last).toMatchObject({ kind: "gate" }); box.last!.submit(""); await expect(gate).resolves.toBeUndefined();
    expect(box.nulls).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ui/model.test.ts tests/unit/ui/prompter.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/ui/tui/model.ts`:
```ts
import type { Check, Portability, State, Step } from "../../engine/artifact.ts";
import type { EngineEvent } from "../../engine/events.ts";
import type { Plan } from "../../engine/plan.ts";

export type Phase = "planning" | "confirm" | "applying" | "verifying" | "done" | "aborted";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";
export interface StepRow { id: string; title: string; interactive: boolean; status: StepStatus; error?: string }
export interface ArtifactRow { id: string; portability: Portability | null; state: State | null; steps: StepRow[]; skipped?: string; checks: Check[] }
export interface Note { level: "info" | "warn" | "error"; message: string }
export interface Model { phase: Phase; rows: ArtifactRow[]; notes: Note[]; exitCode: number | null }
export type Action =
  | EngineEvent
  | { type: "plan:resolved"; plan: Plan }
  | { type: "artifacts"; list: Array<{ id: string; portability: Portability }> }
  | { type: "phase"; phase: Phase }
  | { type: "exit"; code: number };

export const initialModel = (): Model => ({ phase: "planning", rows: [], notes: [], exitCode: null });

export function stateLabel(s: State | null): string {
  if (!s) return "…";
  if (s.kind === "blocked") return `blocked — ${s.reason}`;
  const d = "details" in s && s.details?.length ? ` — ${s.details.join("; ")}` : "";
  return `${s.kind}${d}`;
}

const upsert = (rows: ArtifactRow[], id: string, f: (r: ArtifactRow) => ArtifactRow): ArtifactRow[] => {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return [...rows, f({ id, portability: null, state: null, steps: [], checks: [] })];
  return rows.map((r, j) => (j === i ? f(r) : r));
};
const setStep = (r: ArtifactRow, step: Step, patch: Partial<StepRow>): ArtifactRow => {
  const i = r.steps.findIndex((s) => s.id === step.id);
  const base: StepRow = i < 0 ? { id: step.id, title: step.title, interactive: !!step.interactive, status: "pending" } : r.steps[i];
  const next = { ...base, ...patch };
  return { ...r, steps: i < 0 ? [...r.steps, next] : r.steps.map((s, j) => (j === i ? next : s)) };
};

export function reduce(m: Model, a: Action): Model {
  switch (a.type) {
    case "plan:resolved": return { ...m, rows: a.plan.map((p) => ({ id: p.artifact.id, portability: p.artifact.portability, state: p.state, steps: p.steps.map((s) => ({ id: s.id, title: s.title, interactive: !!s.interactive, status: "pending" as const })), checks: [] })) };
    case "artifacts": return { ...m, rows: a.list.map((x) => ({ id: x.id, portability: x.portability, state: null, steps: [], checks: [] })) };
    case "phase": return { ...m, phase: a.phase };
    case "exit": return { ...m, exitCode: a.code, phase: m.phase === "aborted" ? "aborted" : "done" };
    case "artifact:detected": return { ...m, rows: upsert(m.rows, a.id, (r) => ({ ...r, state: a.state })) };
    case "artifact:skipped": return { ...m, rows: upsert(m.rows, a.id, (r) => ({ ...r, skipped: a.reason, steps: r.steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s)) })) };
    case "step:start": return { ...m, rows: upsert(m.rows, a.artifact, (r) => setStep(r, a.step, { status: "running" })) };
    case "step:done": return { ...m, rows: upsert(m.rows, a.artifact, (r) => setStep(r, a.step, a.ok ? { status: "ok" } : { status: "failed", error: a.error ?? "failed" })) };
    case "prompt:needed": return m;
    case "check:result": return { ...m, rows: upsert(m.rows, a.artifact, (r) => ({ ...r, checks: [...r.checks, a.check] })) };
    case "note": return { ...m, notes: [...m.notes, { level: a.level, message: a.message }] };
  }
}

export function summary(rows: ArtifactRow[]): { ok: number; warn: number; error: number } {
  const all = rows.flatMap((r) => r.checks);
  return { ok: all.filter((c) => c.status === "ok").length, warn: all.filter((c) => c.status === "warn").length, error: all.filter((c) => c.status === "error").length };
}
```

`src/ui/tui/prompter.ts`:
```ts
import type { Prompter } from "../../engine/artifact.ts";

export type PendingKind = "secret" | "text" | "confirm" | "gate";
export interface Pending { kind: PendingKind; label: string; fallback?: string; submit(value: string): void }

/** A Prompter whose calls surface as a Pending for the UI to render; submit() clears it and settles the promise. */
export function bridgePrompter(onPending: (p: Pending | null) => void): Prompter {
  const ask = (kind: PendingKind, label: string, fallback?: string) => new Promise<string>((resolve) => {
    onPending({ kind, label, fallback, submit: (v) => { onPending(null); resolve(v); } });
  });
  return {
    secret: (label) => ask("secret", label),
    text: async (label, fallback) => { const v = (await ask("text", label, fallback)).trim(); return v || fallback || ""; },
    confirm: async (label) => /^y(es)?$/i.test((await ask("confirm", label)).trim()),
    gate: async (label) => { await ask("gate", label); },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ui/model.test.ts tests/unit/ui/prompter.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ui/tui/model.ts src/ui/tui/prompter.ts tests/unit/ui/model.test.ts tests/unit/ui/prompter.test.ts
git commit -m "feat(tui): pure view-model reducer over engine events + Prompter bridge"
```

---

### Task 8: Ink screens — `App`, `PlanRows` / `CheckRows` / `Notes`, `PromptLine`, `runTui`

**Files:**
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/engine/ctx.ts`, `src/ui/tui/components.tsx`, `src/ui/tui/PromptLine.tsx`, `src/ui/tui/App.tsx`, `src/ui/tui/index.tsx`, `tests/unit/ui/streams.ts`, `tests/unit/ui/tui.test.ts`

**Interfaces:**
- Consumes: Task 7's model/prompter; `resolvePlan`, `applyPlan`, `verifyAll`, `worstStatus`, `selectArtifacts`; Ink 7 (`render`, `Box`, `Text`, `useInput`, `useApp`), React 19.
- Produces:
  - `buildCtx(io: Io, profile: Profile, o: { interactive: boolean; prompt: Prompter; emit: (e: EngineEvent) => void }): Promise<Ctx>` in `src/engine/ctx.ts` (moved out of `cli.ts` so the TUI and the CLI build identical contexts).
  - `interface TuiStreams { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream }`
  - `runTui(o: { mode: "onboard" | "doctor"; profile: Profile; io: Io; filter?: { only?: string[]; skip?: string[] }; log?: { emit(e: EngineEvent): void }; streams?: TuiStreams; debug?: boolean }): Promise<number>` — resolves with the exit code (0 ok, 1 failures/errors, 3 aborted at the confirm).
  - Screens per spec §5: **Plan** (rows + steps + confirm), **Apply** (steps tick in place, prompts render inline as a masked/plain input line), **Doctor** (checks grouped per artifact + summary). Ink re-renders the whole tree; it is a handful of rows, so no `Static` bookkeeping.

Ink notes that matter here: `useInput` needs raw mode, so the TUI is only chosen when stdin is a TTY (Task 9); `PromptLine` keeps the typed value in a ref so two keystrokes arriving before a re-render cannot submit a stale value; `debug: true` makes Ink write every full frame (used by tests; on GitHub runners Ink otherwise suppresses intermediate frames because `CI` is set); chalk may colorize frames on CI, so the fake stdout strips ANSI before assertions.

- [ ] **Step 1: Dependencies and config**

```bash
npm install ink@^7.1.1 react@^19.2.0
npm install --save-dev @types/react@^19.2.0
```
`tsconfig.json` — add `"jsx": "react-jsx"` to `compilerOptions`.
`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ esbuild: { jsx: "automatic" }, test: { include: ["tests/**/*.test.{ts,tsx}"] } });
```
`package.json` `test` script stays `vitest run --exclude tests/parity`.

- [ ] **Step 2: Write the failing test**

`tests/unit/ui/streams.ts` (test helper, not a test):
```ts
import { EventEmitter } from "node:events";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** What Ink needs from stdout: columns + write. Frames are kept raw; readers get them ANSI-stripped. */
export class FakeStdout extends EventEmitter {
  columns = 100; rows = 40; isTTY = true; frames: string[] = [];
  write(s: string): boolean { this.frames.push(s); return true; }
  lastFrame(): string { return stripAnsi(this.frames.at(-1) ?? ""); }
  all(): string { return stripAnsi(this.frames.join("\n")); }
}
/** What Ink needs from stdin: a readable that supports raw mode. write() feeds one chunk. */
export class FakeStdin extends EventEmitter {
  isTTY = true; private data: string | null = null;
  setRawMode(): void {} setEncoding(): void {} ref(): void {} unref(): void {} resume(): void {} pause(): void {}
  read(): string | null { const d = this.data; this.data = null; return d; }
  write(s: string): void { this.data = s; this.emit("readable"); this.emit("data", s); }
}
export async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error("waitFor: condition not met in time"); await new Promise((r) => setTimeout(r, 10)); }
}
```

`tests/unit/ui/tui.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { FakeIo } from "../../../src/engine/io.ts";
import type { Profile } from "../../../src/engine/profile.ts";
import { runTui } from "../../../src/ui/tui/index.tsx";
import { FakeStdin, FakeStdout, waitFor } from "./streams.ts";

function fixture() {
  const applied: string[] = []; let answer = "";
  const a: Artifact = { id: "a", requires: [], surfaces: ["code"], portability: "portable", detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [{ id: "a.ok", status: "ok", message: "a fine" }] };
  const b: Artifact = {
    id: "b", requires: ["a"], surfaces: ["code"], portability: "device-bound",
    detect: async () => ({ kind: "absent", details: ["needs a key"] }),
    plan: () => [{ id: "b.ask", title: "paste the key", interactive: true }, { id: "b.do", title: "write the wrapper" }],
    apply: async (c, steps) => { for (const s of steps) { if (s.id === "b.ask") answer = await c.prompt.secret("Paste the key"); applied.push(s.id); } },
    verify: async () => [{ id: "b.warn", status: "warn", message: "b so-so" }],
  };
  const profile: Profile = { name: "t", provider: "gateway", surfaces: ["code"], artifacts: [a, b], options: {} };
  return { profile, applied, answer: () => answer };
}
const start = (mode: "onboard" | "doctor", profile: Profile) => {
  const stdout = new FakeStdout(); const stdin = new FakeStdin();
  const done = runTui({ mode, profile, io: new FakeIo(), streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
  return { stdout, stdin, done };
};

describe("Ink TUI", () => {
  it("onboard: plan → y → masked secret prompt → steps tick → checks; the secret never appears in a frame", async () => {
    const f = fixture(); const { stdout, stdin, done } = start("onboard", f.profile);
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"));
    expect(stdout.lastFrame()).toContain("b [device-bound]: absent — needs a key");
    expect(stdout.lastFrame()).toContain("· paste the key (interactive)");
    stdin.write("y"); stdin.write("\r");
    await waitFor(() => stdout.lastFrame().includes("? Paste the key (blank to skip):"));
    stdin.write("s3cr3t");
    await waitFor(() => stdout.lastFrame().includes("••••••"));
    stdin.write("\r");
    expect(await done).toBe(0);
    expect(f.answer()).toBe("s3cr3t");
    expect(f.applied).toEqual(["b.ask", "b.do"]);
    const last = stdout.lastFrame();
    expect(last).toContain("✓ paste the key");
    expect(last).toContain("✓ write the wrapper");
    expect(last).toContain("! b so-so");
    expect(last).toContain("Doctor: all checks passed (1 warning(s))");
    expect(stdout.all()).not.toContain("s3cr3t");
  });
  it("onboard: n aborts with exit 3 and applies nothing", async () => {
    const f = fixture(); const { stdout, stdin, done } = start("onboard", f.profile);
    await waitFor(() => stdout.lastFrame().includes("Apply this plan?"));
    stdin.write("n"); stdin.write("\r");
    expect(await done).toBe(3);
    expect(f.applied).toEqual([]);
    expect(stdout.lastFrame()).toContain("aborted");
  });
  it("doctor: renders every check grouped by artifact and exits 1 on an error", async () => {
    const f = fixture();
    f.profile.artifacts[0].verify = async () => [{ id: "a.bad", status: "error", message: "a broken" }];
    const { stdout, done } = start("doctor", f.profile);
    expect(await done).toBe(1);
    expect(stdout.lastFrame()).toContain("✗ a broken");
    expect(stdout.lastFrame()).toContain("! b so-so");
    expect(stdout.lastFrame()).toContain("Doctor: 1 check(s) FAILED");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ui/tui.test.ts`
Expected: FAIL — `src/ui/tui/index.tsx` not found.

- [ ] **Step 4: Implement**

`src/engine/ctx.ts`:
```ts
import type { Ctx, Prompter } from "./artifact.ts";
import { probeEnv, resolveEnv } from "./env.ts";
import type { EngineEvent } from "./events.ts";
import type { Io } from "./io.ts";
import type { Profile } from "./profile.ts";
import { selectStore } from "./secrets/store.ts";

/** One context builder for every skin: same env probe, same store, same per-artifact options. */
export async function buildCtx(io: Io, profile: Profile, o: { interactive: boolean; prompt: Prompter; emit: (e: EngineEvent) => void }): Promise<Ctx> {
  const env = resolveEnv(await probeEnv(io), profile.provider, profile.surfaces[0]);
  return { env, io, secrets: selectStore(env, io), prompt: o.prompt, interactive: o.interactive, opts: profile.options, emit: o.emit };
}
```

`src/ui/tui/components.tsx`:
```tsx
import { Box, Text } from "ink";
import type { ArtifactRow, Note, StepRow } from "./model.ts";
import { stateLabel, summary } from "./model.ts";

const ICON = { ok: "✓", warn: "!", error: "✗" } as const;
const COLOR = { ok: "green", warn: "yellow", error: "red" } as const;
const STEP = { pending: "·", running: "…", ok: "✓", failed: "✗", skipped: "-" } as const;

function StepLine({ step }: { step: StepRow }) {
  const color = step.status === "ok" ? "green" : step.status === "failed" ? "red" : step.status === "running" ? "cyan" : step.status === "skipped" ? "yellow" : undefined;
  return (
    <Box paddingLeft={4}>
      <Text color={color}>{STEP[step.status]} {step.title}{step.interactive ? " (interactive)" : ""}{step.error ? ` — ${step.error}` : ""}</Text>
    </Box>
  );
}

/** Spec §5 screen 1/2: one row per artifact (state, portability), its steps beneath. */
export function PlanRows({ rows }: { rows: ArtifactRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Box key={r.id} flexDirection="column">
          <Text>
            <Text bold>{r.id}</Text> <Text dimColor>[{r.portability ?? "?"}]</Text>: {stateLabel(r.state)}
            {r.skipped ? <Text color="yellow"> — skipped: {r.skipped}</Text> : null}
          </Text>
          {r.steps.map((s) => <StepLine key={s.id} step={s} />)}
        </Box>
      ))}
    </Box>
  );
}

/** Spec §5 screen 3: checks grouped per artifact, then the summary line the headless skin prints. */
export function CheckRows({ rows }: { rows: ArtifactRow[] }) {
  const s = summary(rows);
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.filter((r) => r.checks.length).map((r) => (
        <Box key={r.id} flexDirection="column">
          <Text bold>{r.id}</Text>
          {r.checks.map((c, i) => (
            <Box key={`${c.id}-${i}`} paddingLeft={4}><Text color={COLOR[c.status]}>{ICON[c.status]} {c.message}</Text></Box>
          ))}
        </Box>
      ))}
      <Text>
        {s.error ? <Text color="red">Doctor: {s.error} check(s) FAILED</Text> : <Text color="green">Doctor: all checks passed</Text>}
        {s.warn ? <Text color="yellow"> ({s.warn} warning(s))</Text> : null}
      </Text>
    </Box>
  );
}

export function Notes({ notes }: { notes: Note[] }) {
  return (
    <Box flexDirection="column">
      {notes.map((n, i) => (
        <Box key={i} paddingLeft={4}><Text color={n.level === "info" ? undefined : COLOR[n.level]}>{n.level === "info" ? "·" : ICON[n.level]} {n.message}</Text></Box>
      ))}
    </Box>
  );
}
```

`src/ui/tui/PromptLine.tsx`:
```tsx
import { Text, useInput } from "ink";
import { useRef, useState } from "react";
import type { Pending } from "./prompter.ts";

/** One-line input for the four prompt kinds. The value lives in a ref so keystrokes that land before a re-render cannot submit a stale string. */
export function PromptLine({ pending }: { pending: Pending }) {
  const ref = useRef("");
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.return) { const v = ref.current; ref.current = ""; setValue(""); pending.submit(v); return; }
    if (key.backspace || key.delete) { ref.current = ref.current.slice(0, -1); setValue(ref.current); return; }
    if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return;
    ref.current += input; setValue(ref.current);
  });
  const hint = pending.kind === "confirm" ? " [y/N]"
    : pending.kind === "gate" ? " — press Enter when done"
    : pending.fallback ? ` [${pending.fallback}]`
    : pending.kind === "secret" ? " (blank to skip)" : "";
  const shown = pending.kind === "secret" ? "•".repeat(value.length) : value;
  return <Text color="cyan">? {pending.label}{hint}: {shown}▌</Text>;
}
```

`src/ui/tui/App.tsx`:
```tsx
import { Box, Text, useApp } from "ink";
import { useEffect, useReducer, useState } from "react";
import type { Ctx, Prompter } from "../../engine/artifact.ts";
import type { Env } from "../../engine/env.ts";
import { selectArtifacts } from "../../engine/plan.ts";
import type { Profile } from "../../engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "../../engine/run.ts";
import { CheckRows, Notes, PlanRows } from "./components.tsx";
import { initialModel, reduce, type Action } from "./model.ts";
import { PromptLine } from "./PromptLine.tsx";
import { bridgePrompter, type Pending } from "./prompter.ts";

export interface AppProps {
  mode: "onboard" | "doctor";
  profile: Profile;
  filter: { only?: string[]; skip?: string[] };
  /** Built by runTui with the real Io/store; the App only supplies where events and prompts go. */
  makeCtx(emit: (a: Action) => void, prompt: Prompter): Promise<Ctx>;
  onExit(code: number): void;
}

export function App({ mode, profile, filter, makeCtx, onExit }: AppProps) {
  const [m, dispatch] = useReducer(reduce, undefined, initialModel);
  const [pending, setPending] = useState<Pending | null>(null);
  const [env, setEnv] = useState<Env | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    (async () => {
      const ctx = await makeCtx(dispatch, bridgePrompter(setPending));
      setEnv(ctx.env);
      let code = 0;
      if (mode === "doctor") {
        dispatch({ type: "artifacts", list: selectArtifacts(profile).map((a) => ({ id: a.id, portability: a.portability })) });
        dispatch({ type: "phase", phase: "verifying" });
        code = worstStatus(await verifyAll(profile, ctx)) === "error" ? 1 : 0;
      } else {
        const plan = await resolvePlan(profile, ctx, filter);
        dispatch({ type: "plan:resolved", plan });
        dispatch({ type: "phase", phase: "confirm" });
        if (!(await ctx.prompt.confirm("Apply this plan?"))) {
          dispatch({ type: "phase", phase: "aborted" }); dispatch({ type: "exit", code: 3 }); onExit(3); exit(); return;
        }
        dispatch({ type: "phase", phase: "applying" });
        const res = await applyPlan(plan, ctx);
        code = res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
      }
      dispatch({ type: "exit", code }); onExit(code); exit();
    })().catch((e: unknown) => { onExit(1); exit(e instanceof Error ? e : new Error(String(e))); });
  }, []);

  const hasChecks = m.rows.some((r) => r.checks.length > 0);
  return (
    <Box flexDirection="column">
      <Text bold>boot-slapper {mode} — profile {profile.name}{env ? ` on ${env.label} (${env.os}, ${env.provider})` : ""}</Text>
      {mode === "onboard" && <PlanRows rows={m.rows} />}
      {m.notes.length > 0 && <Notes notes={m.notes} />}
      {hasChecks && <CheckRows rows={m.rows} />}
      {pending && <PromptLine pending={pending} />}
      {m.phase === "aborted" && <Text color="yellow">aborted — nothing applied</Text>}
    </Box>
  );
}
```

`src/ui/tui/index.tsx`:
```tsx
import { render } from "ink";
import type { Prompter } from "../../engine/artifact.ts";
import { buildCtx } from "../../engine/ctx.ts";
import type { EngineEvent } from "../../engine/events.ts";
import type { Io } from "../../engine/io.ts";
import type { Profile } from "../../engine/profile.ts";
import { App } from "./App.tsx";
import type { Action } from "./model.ts";

export interface TuiStreams { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream }
export interface TuiOpts {
  mode: "onboard" | "doctor"; profile: Profile; io: Io;
  filter?: { only?: string[]; skip?: string[] };
  log?: { emit(e: EngineEvent): void };
  streams?: TuiStreams;
  /** Ink writes every full frame (tests; also defeats Ink's CI-mode frame suppression). */
  debug?: boolean;
}

/** Renders the Ink skin over the same engine calls the headless runner makes; resolves with the exit code. */
export function runTui(o: TuiOpts): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let code = 1;
    const makeCtx = (emit: (a: Action) => void, prompt: Prompter) =>
      buildCtx(o.io, o.profile, { interactive: true, prompt, emit: (e) => { emit(e); o.log?.emit(e); } });
    const inst = render(
      <App mode={o.mode} profile={o.profile} filter={o.filter ?? {}} makeCtx={makeCtx} onExit={(c) => { code = c; }} />,
      { stdout: o.streams?.stdout ?? process.stdout, stdin: o.streams?.stdin ?? process.stdin, exitOnCtrlC: true, patchConsole: false, debug: o.debug ?? false },
    );
    inst.waitUntilExit().then(() => resolve(code), reject);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/ui/tui.test.ts && npm run typecheck`
Expected: 3 passed; typecheck clean (`tsc` compiles `.tsx` with `react-jsx`).

If Ink 7's `render` rejects the fake streams at runtime, the first thing to check is which method it called on `stdin` (the stack names it) — add that method as a no-op to `FakeStdin`. If frames never contain the prompt, confirm `debug: true` reached `render` (Ink's CI mode otherwise writes nothing until exit).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/engine/ctx.ts src/ui/tui tests/unit/ui/streams.ts tests/unit/ui/tui.test.ts
git commit -m "feat(tui): Ink 7 screens (plan/apply/doctor) over the engine events with an inline masked prompt; runTui() resolves the exit code"
```

---

### Task 9: CLI wiring — TUI by default in a terminal, `--headless`, and the skins-parity test

**Files:**
- Modify: `src/cli.ts`, `tests/unit/cli.test.ts`
- Create: `tests/parity/skins.test.ts`

**Interfaces:**
- Consumes: `runTui`, `TuiStreams` (Task 8), `buildCtx` (Task 8), `doctorSummary` (Task 1), `captureBundle` (Task 5).
- Produces: `main(argv, deps)` where `Deps` gains `tui?: boolean; streams?: TuiStreams; debug?: boolean`. Selection rule: `tui = deps.tui ?? (interactive && !values.headless && !process.env.CI)`, with `interactive = deps.interactive ?? (!values.auto && Boolean(process.stdin.isTTY))`. `--auto` therefore implies headless. `bs doctor --json` is always headless. `bs plan`, `bs capture`, `bs secrets`, `bs env` never use the TUI.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cli.test.ts`:
```ts
  it("onboard picks the TUI when asked and the run log still lands; --headless forces line output", async () => {
    const { FakeStdin, FakeStdout, waitFor } = await import("./ui/streams.ts");
    const io = new FakeIo(); io.on(() => true, () => ({ code: 127, stdout: "", stderr: "" }));      // prereqs blocked → nothing to confirm-apply, but the plan renders
    const stdout = new FakeStdout(); const stdin = new FakeStdin(); const lines = sink();
    const run = main(["onboard"], { io, stdout: lines, stderr: sink(), interactive: true, tui: true, streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"));
    expect(stdout.lastFrame()).toContain("prereqs [device-bound]: blocked");
    stdin.write("n"); stdin.write("\r");
    expect(await run).toBe(3);
    expect(lines.lines.at(-1)).toMatch(/^==> run log: \/h\/\.config\/boot-slapper\/runs\//);
    const out2 = sink();
    expect(await main(["onboard", "--headless", "--auto"], { io, stdout: out2, stderr: sink() })).toBe(1);   // --auto implies headless; blocked prereqs → exit 1
    expect(out2.lines[0]).toMatch(/^==> boot-slapper onboard — profile aca34/);
  });
```

`tests/parity/skins.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { FakeIo } from "../../src/engine/io.ts";
import { renderHooks } from "../../src/engine/settings.ts";
import { aca34 } from "../../src/profiles/aca34.ts";
import { FakeStdin, FakeStdout, waitFor } from "../unit/ui/streams.ts";

const template = JSON.parse(readFileSync("tests/fixtures/settings.template.sample.json", "utf8"));
const canonical = JSON.parse(readFileSync("tests/fixtures/canonical-hooks.sample.json", "utf8"));
const REPO = "/h/projects/claude-memory-sync"; const MCT = "/h/projects/me-count-token"; const P = "/h/.claude/plugins";
const pluginOpts = aca34.options.plugins as { marketplaces: Array<{ name: string; source: string }>; plugins: string[] };

/** Every aca34 artifact satisfied except gateway-launch (wrapper + rc line absent): one identical thing for each skin to apply. */
function box(): FakeIo {
  const settings = { ...template, hooks: renderHooks(canonical.hooks, { platform: "darwin" }), enabledPlugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, true])) };
  const io = new FakeIo({
    hostname: "BOX", env: { USER: "aca34" },
    path: { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", npm: "/usr/local/bin/npm", claude: "/h/.local/bin/claude" },
    dirs: ["/h/.claude", `${REPO}/.git`, `${REPO}/projects/mecp`, MCT],
    files: {
      "/h/.claude/scripts/settings.template.json": JSON.stringify(template), "/h/.claude/scripts/canonical-hooks.json": JSON.stringify(canonical),
      "/h/.claude/settings.json": JSON.stringify(settings, null, 2) + "\n",
      "/h/.claude/mcp/gateway.json": JSON.stringify({ mcpServers: { mecp: { type: "http", url: "https://mecp/mcp" }, openbrain: { type: "http", url: "https://ob/mcp" } } }),
      "/h/.zshrc": "# rc\n", "/h/.config/mecp/api_key": "k\n",
      "/h/.claude/scripts/memory-auto-sync.mjs": "", "/h/.claude/scripts/load-mecp-context.mjs": "",
      [`${REPO}/devices/BOX.json`]: JSON.stringify({ device_label: "BOX", platform: "darwin", mappings: {} }) + "\n",
      [`${MCT}/dist/hooks/session-start.js`]: "", "/h/.mct/config.json": JSON.stringify({ deviceId: "box" }),
      [`${P}/known_marketplaces.json`]: JSON.stringify(Object.fromEntries(pluginOpts.marketplaces.map((m) => [m.name, { source: { source: "github", repo: m.source } }]))),
      [`${P}/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: Object.fromEntries(pluginOpts.plugins.map((p) => [p, [{ scope: "user", version: "1.0.0" }]])) }),
    },
  });
  io.on((c) => c === "ssh", () => ({ code: 1, stdout: "", stderr: "successfully authenticated" }));
  io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 0, stdout: "/h/.claude\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("ls-remote"), () => ({ code: 0, stdout: "abc\trefs/heads/main\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("rev-parse"), () => ({ code: 0, stdout: "abc\n", stderr: "" }));
  io.on((c, a) => c === "git" && a.includes("status"), () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
  io.on((c, a) => c === "node" && a[1] === "doctor", () => ({ code: 0, stdout: "", stderr: "" }));
  io.on((c) => c === "bash", () => ({ code: 0, stdout: "", stderr: "" }));
  return io;
}
const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };
const doctor = async (io: FakeIo) => { const out = sink(); const code = await main(["doctor", "--json"], { io, stdout: out, stderr: sink() }); return { code, json: JSON.parse(out.lines.join("\n")) }; };
const filesOf = (io: FakeIo) => Object.fromEntries([...io.files].filter(([k]) => !k.startsWith("/h/.config/boot-slapper/runs/")));

describe("skins parity: the Ink TUI and the headless runner leave the box in the same state", () => {
  it("onboard through both skins, then doctor --json agrees and the written files are identical", { timeout: 30_000 }, async () => {
    const headless = box();
    expect(await main(["onboard", "--auto"], { io: headless, stdout: sink(), stderr: sink() })).toBe(0);

    const tui = box(); const stdout = new FakeStdout(); const stdin = new FakeStdin();
    const run = main(["onboard"], { io: tui, stdout: sink(), stderr: sink(), interactive: true, tui: true, streams: { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream }, debug: true });
    await waitFor(() => stdout.lastFrame().includes("Apply this plan? [y/N]"), 15_000);
    expect(stdout.lastFrame()).toContain("gateway-launch [translatable]: absent");
    stdin.write("y"); stdin.write("\r");
    expect(await run).toBe(0);

    const a = await doctor(headless), b = await doctor(tui);
    expect(a.code).toBe(0);
    expect(b.json.checks).toEqual(a.json.checks);
    expect(filesOf(tui)).toEqual(filesOf(headless));
    expect(Object.keys(filesOf(headless))).toEqual(expect.arrayContaining(["/h/.config/boot-slapper/claude-gw.zsh"]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/cli.test.ts tests/parity/skins.test.ts`
Expected: FAIL — `main` ignores `tui`/`streams` and runs headless; `--headless` is an unknown option (exit 2).

- [ ] **Step 3: Rewrite `src/cli.ts`**

Replace the file with (only `env`, `plan`, `secrets` bodies are unchanged from Phase 1):
```ts
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { InteractiveRequired } from "./engine/artifact.ts";
import { captureBundle, SecretScanError, type CaptureResult } from "./engine/capture.ts";
import { buildCtx } from "./engine/ctx.ts";
import { pj, probeEnv, toOs } from "./engine/env.ts";
import type { EngineEvent } from "./engine/events.ts";
import { RealIo, type Io } from "./engine/io.ts";
import type { Profile } from "./engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "./engine/run.ts";
import { defaultAccount, type SecretService } from "./engine/secrets/store.ts";
import { aca34 } from "./profiles/aca34.ts";
import { doctorSummary, headlessReporter, renderChecksText, renderPlanText, runLogWriter, type Sink } from "./ui/headless.ts";
import { headlessPrompter, ttyPrompter } from "./ui/prompt.ts";
import { runTui, type TuiStreams } from "./ui/tui/index.tsx";

const PROFILES: Record<string, Profile> = { aca34 };
const SERVICES: SecretService[] = ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"];

const USAGE = `usage: bs — boot-slapper
  bs env
  bs plan    [--profile aca34] [--only a,b] [--skip a,b]
  bs doctor  [--profile aca34] [--json] [--headless]
  bs onboard [--profile aca34] [--auto] [--headless] [--only a,b] [--skip a,b]
  bs capture --out <dir> [--profile aca34]
  bs secrets set|check <${SERVICES.join("|")}>
  --auto      no prompts: interactive steps are skipped with a warning (implies --headless)
  --headless  line output instead of the Ink screens (also the default when stdin is not a terminal or CI is set)`;

interface Deps { io?: Io; stdout?: Sink; stderr?: Sink; interactive?: boolean; tui?: boolean; streams?: TuiStreams; debug?: boolean }

const ctxFor = (io: Io, profile: Profile, interactive: boolean, emit: (e: EngineEvent) => void) =>
  buildCtx(io, profile, { interactive, prompt: interactive ? ttyPrompter() : headlessPrompter(), emit });

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const io = deps.io ?? new RealIo();
  const stdout = deps.stdout ?? { write: (l: string) => process.stdout.write(l + "\n") };
  const stderr = deps.stderr ?? { write: (l: string) => process.stderr.write(l + "\n") };
  const [cmd, ...rest] = argv;
  let values: Record<string, string | boolean | undefined>, positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      profile: { type: "string", default: "aca34" }, json: { type: "boolean" }, auto: { type: "boolean" }, headless: { type: "boolean" },
      only: { type: "string" }, skip: { type: "string" }, out: { type: "string" },
    } }));
  } catch (e) { stderr.write(String(e instanceof Error ? e.message : e)); stderr.write(USAGE); return 2; }

  const profile = PROFILES[String(values.profile)];
  if (!profile && cmd !== "env") { stderr.write(`unknown profile: ${String(values.profile)}`); stderr.write(USAGE); return 2; }
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : undefined);
  const filter = { only: list(values.only), skip: list(values.skip) };
  const interactive = deps.interactive ?? (!values.auto && Boolean(process.stdin.isTTY));
  const tui = deps.tui ?? (interactive && !values.headless && !process.env.CI);
  const os = toOs(io.platform);

  switch (cmd) {
    case "env": { stdout.write(JSON.stringify(await probeEnv(io), null, 2)); return 0; }
    case "plan": {
      const ctx = await ctxFor(io, profile, false, () => {});
      stdout.write(renderPlanText(await resolvePlan(profile, ctx, filter)).trimEnd());
      return 0;
    }
    case "doctor": {
      if (tui && !values.json) return runTui({ mode: "doctor", profile, io, streams: deps.streams, debug: deps.debug });
      const ctx = await ctxFor(io, profile, false, () => {});
      const checks = await verifyAll(profile, ctx);
      const status = worstStatus(checks);
      if (values.json) stdout.write(JSON.stringify({ profile: profile.name, env: ctx.env, status, checks }, null, 2));
      else stdout.write(renderChecksText(checks).trimEnd());
      return status === "error" ? 1 : 0;
    }
    case "onboard": {
      const log = runLogWriter(io, pj(os, io.home, ".config", "boot-slapper", "runs"), new Date());
      if (tui) {
        const code = await runTui({ mode: "onboard", profile, io, filter, log, streams: deps.streams, debug: deps.debug });
        stdout.write(`==> run log: ${log.path}`);
        await log.done();
        return code;
      }
      const report = headlessReporter(stdout);
      const ctx = await ctxFor(io, profile, interactive, (e) => { report(e); log.emit(e); });
      stdout.write(`==> boot-slapper onboard — profile ${profile.name} on ${ctx.env.label} (${ctx.env.os}, ${ctx.env.provider}${interactive ? "" : ", --auto"})`);
      const plan = await resolvePlan(profile, ctx, filter);
      stdout.write(renderPlanText(plan).trimEnd());
      if (interactive && !(await ctx.prompt.confirm("Apply this plan?"))) { stdout.write("aborted"); await log.done(); return 3; }
      const res = await applyPlan(plan, ctx);
      stdout.write(doctorSummary(res.checks));
      stdout.write(`==> run log: ${log.path}`);
      await log.done();
      return res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
    }
    case "capture": {
      const out = typeof values.out === "string" ? values.out : "";
      if (!out) { stderr.write("bs capture needs --out <dir>"); stderr.write(USAGE); return 2; }
      if (await io.exists(pj(os, out, "manifest.json"))) { stderr.write(`${out} already holds a bundle (manifest.json) — choose another --out`); return 1; }
      const ctx = await ctxFor(io, profile, false, headlessReporter(stdout));
      let res: CaptureResult;
      try { res = await captureBundle(profile, ctx); }
      catch (e) { if (e instanceof SecretScanError) { stderr.write(e.message); return 1; } throw e; }
      for (const f of res.files) await io.writeFile(pj(os, out, ...f.path.split("/")), f.content);
      await io.writeFile(pj(os, out, "instructions.md"), res.instructions);
      await io.writeFile(pj(os, out, "manifest.json"), JSON.stringify(res.manifest, null, 2) + "\n");
      stdout.write(`==> bundle written: ${out} (${res.files.length} file(s), ${res.manifest.artifacts.length} artifact(s))`);
      return 0;
    }
    case "secrets": {
      const [op, svc] = positionals;
      if (!["set", "check"].includes(op) || !SERVICES.includes(svc as SecretService)) { stderr.write(USAGE); return 2; }
      const ctx = await ctxFor(io, profile ?? aca34, interactive, () => {});
      const ref = { service: svc as SecretService, account: defaultAccount(io) };
      if (op === "check") {
        const present = (await ctx.secrets.get(ref)) !== null;
        stdout.write(`${svc}: ${present ? "present" : "missing"} (${ctx.secrets.describe(ref)})`);
        return present ? 0 : 1;
      }
      let value: string;
      try { value = (await ctx.prompt.secret(`Paste ${svc}`)).trim(); }
      catch (e) {
        if (e instanceof InteractiveRequired) { stderr.write(`bs secrets set needs an interactive terminal (${e.message})`); return 2; }
        throw e;
      }
      if (!value) { stderr.write("blank — nothing stored"); return 1; }
      await ctx.secrets.set(ref, value);
      stdout.write(`${svc}: stored (${ctx.secrets.describe(ref)})`);
      return 0;
    }
    default: stderr.write(USAGE); return 2;
  }
}

if ((process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) || process.argv[1]?.endsWith("/dist/cli.js") || process.argv[1]?.endsWith("\\dist\\cli.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test && npm run test:parity && npm run build && node dist/cli.js plan --headless`
Expected: unit green; `skins.test.ts` green (doctor parity still self-skips off this mac); the build emits `dist/ui/tui/*.js`; `plan` prints the seven-artifact plan for this mac with no TUI (plan never uses it). Then, in a real terminal on this mac: `npx tsx src/cli.ts doctor` should draw the Doctor screen and exit with the same status as `--headless`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/unit/cli.test.ts tests/parity/skins.test.ts
git commit -m "feat(cli): Ink TUI by default in a terminal, --headless to opt out; skins-parity test proves both skins leave the box identical"
```

---

### Task 10: Fresh-box shims — `install.sh` and `install.ps1`

**Files:**
- Create: `install.sh`, `install.ps1`, `tests/unit/shims.test.ts`

**Interfaces:**
- Produces the two entry points from spec §5: `curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash` and `irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex`. Each ensures node ≥ 22.5 (Homebrew on macOS, winget on Windows — the one thing the engine cannot do for itself), clones or fast-forwards `~/projects/boot-slapper` (override with `BOOT_SLAPPER_DIR`), runs `npm ci && npm run build`, and execs `bs onboard`. Idempotent. Extra args after `bash -s --` reach `bs onboard` (`… | bash -s -- --auto`).
- Not in scope: Linux package installation (prints the instruction and exits 1), and the `dotfiles/install.*` step-3 hand-off (gate 2, Phase 3).

- [ ] **Step 1: Write the failing test**

`tests/unit/shims.test.ts`:
```ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sh = () => readFileSync("install.sh", "utf8");
const ps1 = () => readFileSync("install.ps1", "utf8");
const has = (cmd: string) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }).status === 0;

describe("install shims", () => {
  it("install.sh: parses, is strict, never sudo, clones the public repo and execs onboard with the caller's args", () => {
    const s = sh();
    expect(s.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(s).toContain("set -euo pipefail");
    expect(s).toContain('REPO_URL="https://github.com/merpuya/boot-slapper.git"');
    expect(s).toContain('exec node "$DIR/dist/cli.js" onboard "$@"');
    expect(s).toContain("brew install node");
    expect(s).not.toMatch(/\bsudo\b/);
    if (has("bash")) expect(spawnSync("bash", ["-n", "install.sh"], { encoding: "utf8" }).status).toBe(0);
  });
  it("install.ps1: stops on error, installs node LTS + git via winget, builds, and re-raises bs's exit code", () => {
    const s = ps1();
    expect(s).toContain('$ErrorActionPreference = "Stop"');
    expect(s).toContain("winget install --id OpenJS.NodeJS.LTS");
    expect(s).toContain("winget install --id Git.Git");
    expect(s).toContain("npm ci --no-audit --no-fund");
    expect(s).toContain("exit $LASTEXITCODE");
    if (process.platform === "win32") {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", "$null = [scriptblock]::Create((Get-Content -Raw install.ps1)); exit 0"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/shims.test.ts`
Expected: FAIL — ENOENT `install.sh`.

- [ ] **Step 3: Write the shims**

`install.sh`:
```bash
#!/usr/bin/env bash
# install.sh — boot-slapper fresh-box shim (macOS; Linux prints what to install)
#   curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --auto        # args go to `bs onboard`
# Ensures node >= 22.5, clones or fast-forwards $BOOT_SLAPPER_DIR (default ~/projects/boot-slapper),
# builds, then execs `bs onboard`. Idempotent. Windows: install.ps1.
set -euo pipefail

REPO_URL="https://github.com/merpuya/boot-slapper.git"
DIR="${BOOT_SLAPPER_DIR:-$HOME/projects/boot-slapper}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit(M>22||(M===22&&m>=5)?0:1)'
}

if ! node_ok; then
  case "$(uname -s)" in
    Darwin)
      command -v brew >/dev/null 2>&1 || die "node >= 22.5 is required and Homebrew is missing — install Homebrew (https://brew.sh), then re-run"
      say "installing node via Homebrew"
      brew install node
      node_ok || die "node is still < 22.5 on PATH — open a new terminal and re-run" ;;
    Linux) die "node >= 22.5 is required — install it with your package manager (e.g. NodeSource), then re-run" ;;
    *) die "unsupported platform $(uname -s) — on Windows run install.ps1" ;;
  esac
fi
command -v git >/dev/null 2>&1 || die "git is required — install it, then re-run"

if [ -d "$DIR/.git" ]; then
  say "updating $DIR"
  git -C "$DIR" pull --ff-only --quiet || printf '    ! pull failed — using the existing checkout\n' >&2
else
  say "cloning boot-slapper to $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$REPO_URL" "$DIR"
fi

say "building"
npm --prefix "$DIR" ci --no-audit --no-fund --silent
npm --prefix "$DIR" run --silent build

say "bs onboard"
exec node "$DIR/dist/cli.js" onboard "$@"
```

`install.ps1`:
```powershell
<#
install.ps1 — boot-slapper fresh-box shim (Windows)
  irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex
Ensures node >= 22.5 and git (winget), clones or fast-forwards $env:BOOT_SLAPPER_DIR (default ~\projects\boot-slapper),
builds, then runs `bs onboard`. Idempotent. `iex` cannot pass arguments: for flags run
  node "$HOME\projects\boot-slapper\dist\cli.js" onboard --auto
#>
$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/merpuya/boot-slapper.git"
$Dir = if ($env:BOOT_SLAPPER_DIR) { $env:BOOT_SLAPPER_DIR } else { Join-Path $HOME "projects\boot-slapper" }

function Say($m) { Write-Host "==> $m" -ForegroundColor Blue }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Test-NodeOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $parts = ((& node --version) -replace '^v', '').Split('.')
  $maj = [int]$parts[0]; $min = [int]$parts[1]
  return ($maj -gt 22) -or ($maj -eq 22 -and $min -ge 5)
}

if (-not (Test-NodeOk)) {
  Say "installing Node.js LTS via winget"
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Test-NodeOk)) { throw "node >= 22.5 is still not on PATH — open a new terminal and re-run" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Say "installing Git via winget"
  winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is still not on PATH — open a new terminal and re-run" }
}

if (Test-Path (Join-Path $Dir ".git")) {
  Say "updating $Dir"
  & git -C $Dir pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { Write-Warning "pull failed — using the existing checkout" }
} else {
  Say "cloning boot-slapper to $Dir"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dir) | Out-Null
  & git clone --quiet $RepoUrl $Dir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}

Say "building"
& npm --prefix $Dir ci --no-audit --no-fund --silent
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
& npm --prefix $Dir run --silent build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Say "bs onboard"
& node (Join-Path $Dir "dist\cli.js") onboard
exit $LASTEXITCODE
```
Make `install.sh` executable: `chmod +x install.sh`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/shims.test.ts && bash -n install.sh`
Expected: 2 passed; `bash -n` silent. The PowerShell parse runs on the Windows CI job.

- [ ] **Step 5: Commit**

```bash
git add install.sh install.ps1 tests/unit/shims.test.ts
git commit -m "feat(shims): install.sh / install.ps1 — node via brew/winget, clone or ff-pull, build, exec bs onboard"
```

---

### Task 11: Docs, spec touch-ups, `CLAUDE.md` follow-ups index, phase report

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: README**

Replace the `## Commands` block and the paragraph after it with:
```
## Commands

    bs env                                              # what this box looks like (os, label, detected provider)
    bs plan    [--profile aca34] [--only a,b]           # what onboard WOULD do — read-only
    bs doctor  [--profile aca34] [--json] [--headless]  # verify every artifact — read-only, exit 1 on any error
    bs onboard [--profile aca34] [--auto] [--headless]  # plan → confirm → apply → verify
    bs capture --out <dir>                              # portable/translatable state as a bundle dir (spec §5); refuses secret-shaped strings
    bs secrets set|check <service>                      # cornell-ai-gateway | mecp-device-token | mecp-api-key | mct-sync-token

In a terminal `onboard` and `doctor` draw Ink screens (plan → apply → doctor); `--headless` gives the
line output, and `--auto` (no prompts, interactive steps skipped with a warning) implies it. Piped stdin
or `CI` also mean headless. Every onboard writes `~/.config/boot-slapper/runs/<timestamp>.jsonl`.

Fresh box:

    curl -fsSL https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.sh | bash
    irm https://raw.githubusercontent.com/merpuya/boot-slapper/main/install.ps1 | iex

Artifacts on the `code` surface (profile `aca34`): `prereqs`, `claude-config`, `secrets`, `gateway-launch`,
`project-memory`, `mct`, `plugins`. The desktop surface is Phase 3.

Secrets live in the login Keychain (macOS) or Windows Credential Manager; `mecp-api-key` lives in
`~/.config/mecp/api_key` because the SessionStart hook reads that file; `mct-sync-token` is copied into
`~/.mct/config.json` (mct's own store) at activation. Values are entered at a hidden prompt and never
appear on a command line.

`bs capture` reads bundle files as UTF-8 text; dotclaude tracks no binaries today.
```
Update the last line of the Develop section to name both plan files: Phase 1 `2026-09-09-boot-slapper-phase1-engine.md`, Phase 2 `2026-09-10-boot-slapper-phase2-artifacts-tui.md`.

- [ ] **Step 2: Spec touch-ups** (append a dated note; do not rewrite history)

At the end of §4, after the "Spikes required" block, add:
```
**Amendments (2026-09-10, Phase 2):** row 6 — the mct sync token is delivered by seeding `~/.mct/config.json`
(mode 600) and running a bare `mct onboard` (its repair pass), not `--token`: the no-secret-on-argv rule wins.
Row 5 — the device config is extended append-only with newly discovered, guessable memory dirs; unguessable
ones stay doctor warnings. Row 7 — a plugin the user disabled is reported, never re-enabled.
```
At the end of §5's "TUI (Ink)" paragraph add: `Ink 7 / React 19 (2026-09-10). \`--headless\` opts out; \`--auto\`, piped stdin, and \`CI\` imply it.`

- [ ] **Step 3: `CLAUDE.md`** (new; short — the plan files carry the narrative)

```markdown
# boot-slapper

Cross-platform onboarding for Claude Code against a third-party provider. Design: `docs/superpowers/specs/2026-09-09-boot-slapper-design.md`.
Plans: `docs/superpowers/plans/` (Phase 1 engine, Phase 2 artifacts + TUI + capture + shims; Phase 3 desktop + cutover pending).

## Commands

    npm ci && npm test              # unit suite against the recording Io fake (no machine access)
    npm run test:parity             # gate 1 (bs doctor vs ~/.claude/bootstrap.sh --doctor; self-skips without it) + TUI-vs-headless skins parity
    npm run typecheck && npm run build && node dist/cli.js plan

## Rules that are not obvious from the code

- `src/engine/` and `src/artifacts/` never import `src/ui/`. Ink/React only under `src/ui/tui/`; `model.ts` and `prompter.ts` stay renderer-free.
- `detect` / `verify` / `capture` never write; `tests/unit/artifacts/contract.test.ts` enforces it with an exec allowlist — extend the allowlist when an artifact gains a read-only probe.
- Secret values never touch argv, events, logs, or bundles. Child processes get them on stdin or in a mode-600 file they own (`~/.mct/config.json`).
- Windows: never spawn `.cmd`/`.bat` directly (see `npmArgv` in `src/artifacts/mct.ts`); build paths with `pj(env.os, …)`.
- Cutover state (spec §6): `bootstrap.sh` and `claude-gw.zsh` stay live until gate 2. Only `bs env | plan | doctor | capture` are meant to touch a real box before then.

## Known follow-ups

- Deferred engine cleanups (Phase 1 roadmap item 7, minus what Phase 2 landed): `State.facts`, cross-surface `requires` in `resolveOrder` (Phase 3), tests typecheck, `_writeToOutput` guard, non-44 Keychain exit codes, `doctor --json` redaction, `BS_REQUIRE_PARITY=1`, `homeRel` boundary check, gateway-launch `.bak` before regenerating — see the Phase 2 plan, "Deviations" §4.
- `bs capture` reads bundle files as UTF-8 text; extend `Io.readFile` to bytes if dotclaude ever tracks a binary.
- Interactive `project-memory` re-offers a guessed-but-declined memory dir on every run; map it by hand (or accept) to silence it.
```

- [ ] **Step 4: Final verification and phase report**

Run: `npm run typecheck && npm test && npm run test:parity && npm run build && node dist/cli.js env && node dist/cli.js plan --headless && node dist/cli.js doctor --headless; echo "exit=$?"`
Expected: all suites green; `plan` lists seven artifacts; `doctor` on this mac reports the same reds the bash doctor reports today (hooks drift on JCB-AL-ACA34 is a dotclaude reconcile, not a boot-slapper bug) and exits 1 only for those.

Then, in a real terminal (not through a pipe): `npx tsx src/cli.ts doctor` — confirm the Ink Doctor screen renders and the exit code matches `--headless`.

Phase report (per the owner's phase-boundary convention): commits, test counts (unit and parity), the four deviations above restated, and the single next question — **whether to run `bs onboard --only plugins,project-memory` on this mac now (both idempotent, both adopt-never-clobber) or wait for the new boxes.**

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-09-boot-slapper-design.md
git commit -m "docs: Phase 2 — README commands/shims, spec amendments (mct token path, memory config, plugins), CLAUDE.md with follow-ups index"
```

---

## Self-review

**Spec coverage (Phase 2 scope):**
- §4 row 5 `project-memory` — Task 2 (clone, device config with logical-name guessing, initial `sync-memory pull` — push-first per the memory-sync incident, doctor coverage checks). Row 6 `mct` — Task 3 (clone/build at the first `HOOK_CHECKOUT_PROBES` path, activation with the token from the store, `mct doctor` warn-only). Row 7 `plugins` — Task 4 (profile lists marketplaces + plugin ids; restore via `claude plugin marketplace add` / `claude plugin install`; `capture` reads `~/.claude/plugins/`).
- §2 `bs capture --out <dir>` — Tasks 5–6. `capture?` on the Artifact interface — Task 1. Invariant 1 extended to `capture` — contract test in Task 6.
- §5 Ink TUI, three screens, no free navigation; `prompt:needed`-style pauses as an inline hidden input or "done" gate; headless parity as a test — Tasks 7–9 (`tests/parity/skins.test.ts`). Engine/UI boundary — Global Constraints + `CLAUDE.md`. Fresh-box entry points — Task 10. Run log — unchanged, now append-only and complete (every check event) — Task 1. Bundle layout (`manifest.json`, `claude-config/`, `plugins.json`, `memory/`, `instructions.md`), device-bound refusal, secret scan — Tasks 5–6. `desktop-skills/` in the bundle arrives with the Phase 3 artifact.
- §6 — no gate changes; the plan says so twice (Phase map, `CLAUDE.md`).
- §7 layout (`ui/tui/`, `install.sh` / `install.ps1`, `tests/parity/`) — matches; error classes reused (blocked for missing `npm` / `claude`; apply failure with stderr tail; drift never overwritten).
- Phase 1 roadmap item 7 — partially landed; the remainder is indexed in `CLAUDE.md` (Task 11).
- **Gap, deliberate:** `bs migrate` stays reserved (sub-project B). `desktop-*` rows and `open-brain-auth` / `hosted-connectors` are Phase 3.

**Placeholder scan:** none. Every step carries its code; the only "if X then Y" instructions are troubleshooting notes after a concrete expected result (Task 8 Step 5, Task 9 Step 1).

**Type consistency:**
- `Prompter.text(label, fallback?)` — declared Task 1; implemented in `headlessPrompter`, `ttyPrompter` (Task 1), `bridgePrompter` (Task 7), test helpers (Task 1); consumed by `project-memory` (Task 2) and `mct` (Task 3).
- `Bundle { files: BundleFile[]; instructions: string[] }` — Task 1; produced by Tasks 2, 3, 4, 6; consumed by `captureBundle` (Task 5).
- `PlanEntry.opts` — Task 1; `applyPlan` reads `entry.opts` in both loops; `resolvePlan` fills it from `profile.options[id] ?? {}`.
- `check:result` emitted by `safeVerify` (Task 1) → headless reporter groups it (Task 1) → `reduce` upserts it (Task 7) → `CheckRows` renders it (Task 8); the CLI's onboard tail prints `doctorSummary` only (Tasks 1, 9).
- `runTui({ mode, profile, io, filter?, log?, streams?, debug? })` — Task 8 signature; Task 9 calls it with exactly those fields; tests pass `streams` + `debug`.
- `buildCtx(io, profile, { interactive, prompt, emit })` — Task 8 (`engine/ctx.ts`); the CLI's `ctxFor` wraps it (Task 9); `runTui` calls it with the bridge prompter.
- `npmArgv(io, os)` returns `[cmd, prefixArgs] | null`; `mct.apply` spreads `prefixArgs` before `--prefix` (Task 3).
- `D` prefix constants are per-artifact exports (`project-memory`, `mct`, `plugins`) and each artifact's `plan()` only parses its own.
- Contract test allowlist after Task 3: `git` (rev-parse/status/ls-remote), `security find-generic-password`, `powershell`, `ssh`, `node --version` or `node <…dist/cli.js> doctor`, `bash <…sync-memory> … list`. `plugins` adds no probe.
- Manifest artifact order in the CLI test (Task 6) follows `resolveOrder`'s Kahn queue: `prereqs, claude-config, secrets, project-memory, plugins, gateway-launch, mct` minus `gateway-launch` (no `capture`).
