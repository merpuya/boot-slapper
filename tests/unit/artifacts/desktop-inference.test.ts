import { describe, expect, it } from "vitest";
import { D, desktopInference, wantedDoc } from "../../../src/artifacts/desktop-inference.ts";
import { ENTRY_NAME, resetDesktopProbeCache } from "../../../src/engine/desktop.ts";
import type { FakeIo } from "../../../src/engine/io.ts";
import { makeCtx } from "../helpers.ts";

const opts = { baseUrl: "https://api.ai.it.cornell.edu" };
const APP = "/Applications/Claude.app";
const PLIST = "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>";
const L = "/h/Library/Application Support/Claude-3p/configLibrary";
const HELPER = "/h/.config/boot-slapper/desktop-inference-credential.sh";
const box = (extra: Record<string, string> = {}) => makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST, ...extra } });
const secrets = (io: FakeIo, present = true) => io.on((c, a) => c === "security" && a[0] === "find-generic-password", () => present ? { code: 0, stdout: "s3cr3t-val\n", stderr: "" } : { code: 44, stdout: "", stderr: "" });
const leak = (io: FakeIo, events: unknown[]) => JSON.stringify([...io.files.values(), ...events]).includes("s3cr3t-val");

describe("desktop-inference (darwin)", () => {
  it("fresh box: absent → helper + entry + apply; files are owner-only; second detect is present; nothing leaks", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [`${D.helper} — will write ${HELPER}`, `${D.entry} — will add an entry named '${ENTRY_NAME}' and apply it (existing entries untouched)`] });
    expect(io.writes).toEqual([]);
    const steps = desktopInference.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["desktop-inference.helper", "desktop-inference.entry", "desktop-inference.apply-entry"]);
    await desktopInference.apply(ctx, steps);
    expect(io.modes.get(HELPER)).toBe(0o700);
    expect(io.files.get(HELPER)).toContain("security find-generic-password -w -s cornell-ai-gateway");
    const meta = JSON.parse(io.files.get(`${L}/_meta.json`)!);
    expect(meta.entries).toEqual([{ id: meta.appliedId, name: ENTRY_NAME }]);
    expect(meta.appliedId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.parse(io.files.get(`${L}/${meta.appliedId}.json`)!)).toEqual(wantedDoc(opts, HELPER));
    expect(io.modes.get(`${L}/${meta.appliedId}.json`)).toBe(0o600);
    expect(JSON.parse(io.files.get("/h/.config/boot-slapper/desktop.json")!)).toEqual({ entryId: meta.appliedId });
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
    expect(desktopInference.plan(ctx, { kind: "present" })).toEqual([]);
    expect(leak(io, events)).toBe(false);
  });

  it("a foreign applied entry that already satisfies the profile is adopted read-only", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const { ctx, io } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: "Default" }] }),
      [`${L}/${id}.json`]: JSON.stringify({ $schemaVersion: 2, inference: { provider: "gateway", baseUrl: "https://api.ai.it.cornell.edu/", credential: { kind: "static", apiKey: "x" } } }),
      [HELPER]: "stale",
    });
    secrets(io);
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
    expect((await desktopInference.verify(ctx)).find((c) => c.id === "entry")).toEqual({ id: "entry", status: "ok", message: "adopted the applied configuration 'Default' (gateway, https://api.ai.it.cornell.edu/) — not managed by boot-slapper" });
    expect(io.writes).toEqual([]);
  });

  it("a foreign applied entry for something else is left alone: ours is added beside it and becomes the applied one", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const foreign = JSON.stringify({ inferenceProvider: "anthropic", inferenceAnthropicApiKey: "k" });
    const { ctx, io } = await box({ [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: "Default" }] }), [`${L}/${id}.json`]: foreign });
    secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s.kind).toBe("absent");
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    const meta = JSON.parse(io.files.get(`${L}/_meta.json`)!);
    expect(meta.entries.map((e: { name: string }) => e.name)).toEqual(["Default", ENTRY_NAME]);
    expect(meta.appliedId).not.toBe(id);
    expect(io.files.get(`${L}/${id}.json`)).toBe(foreign);
  });

  it("our entry keeps keys other artifacts or the user put there; only the owned keys are rewritten; not-applied is a single step", async () => {
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const doc = { ...wantedDoc(opts, HELPER), managedMcpServers: [{ name: "mecp", transport: "http", url: "https://mecp/mcp" }], workspace: { autoModeEnabled: true } };
    const { ctx, io } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: other, entries: [{ id: other, name: "Default" }, { id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify(doc), [`${L}/${other}.json`]: "{}",
      [HELPER]: "stale", "/h/.config/boot-slapper/desktop.json": JSON.stringify({ entryId: id }),
    });
    secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: [`${D.helper} — will write ${HELPER}`, `${D.notApplied} — will apply it`] });
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    expect(JSON.parse(io.files.get(`${L}/_meta.json`)!).appliedId).toBe(id);
    expect(JSON.parse(io.files.get(`${L}/${id}.json`)!)).toEqual(doc);          // untouched: it already matched
    // now drift the owned keys
    io.files.set(`${L}/${id}.json`, JSON.stringify({ ...doc, inferenceGatewayBaseUrl: "https://old" }));
    const s2 = await desktopInference.detect(ctx);
    expect(s2).toEqual({ kind: "drifted", details: [`${D.stale} — will rewrite the inference keys`] });
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s2));
    expect(JSON.parse(io.files.get(`${L}/${id}.json`)!)).toEqual(doc);
  });

  // S4 (2026-09-18, yogaNovo, Desktop 2.2553.0.0): the app discarded every nested v2 key by name
  // ("Ignoring local configuration value \"inference\": not a recognized configuration key") and reported
  // mcpServerCount: 0. Pin the flat spellings so a nested shape cannot come back unnoticed.
  it("writes flat v1 keys only — never the nested v2 shape the app ignores", () => {
    const doc = wantedDoc(opts, HELPER);
    expect(doc).toEqual({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "https://api.ai.it.cornell.edu",
      inferenceGatewayAuthScheme: "bearer",
      inferenceCredentialKind: "helper-script",
      inferenceCredentialHelper: HELPER,
      inferenceCredentialHelperTtlSec: 3600,
      modelDiscoveryEnabled: true,
      disableNonessentialTelemetry: true,
      disableNonessentialServices: true,
    });
    for (const k of ["$schemaVersion", "inference", "models", "telemetry", "mcp"]) expect(doc).not.toHaveProperty(k);
    expect(wantedDoc({ ...opts, authScheme: "x-api-key" }, HELPER).inferenceGatewayAuthScheme).toBe("x-api-key");
  });

  // The entry on yogaNovo carried a v2 block boot-slapper itself wrote pre-S4, beside the app's flat keys.
  // Rewriting must fix the flat keys and leave the dead nested block alone rather than trying to reconcile it.
  it("an entry still carrying a pre-S4 nested block: flat keys are rewritten, the dead v2 block is left untouched", async () => {
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const dead = { $schemaVersion: 2, inference: { provider: "gateway", baseUrl: "https://old", credential: { kind: "helper-script", command: "/old" } } };
    const { ctx, io } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify({ ...dead, inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://old" }),
      [HELPER]: "stale",
    });
    secrets(io);
    const s = await desktopInference.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: [`${D.helper} — will write ${HELPER}`, `${D.stale} — will rewrite the inference keys`] });
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    const after = JSON.parse(io.files.get(`${L}/${id}.json`)!);
    expect(after).toMatchObject(wantedDoc(opts, HELPER));   // flat keys corrected
    expect(after.$schemaVersion).toBe(2);                   // the ignored block is not boot-slapper's to remove
    expect(after.inference).toEqual(dead.inference);
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
  });

  // yogaNovo, 2026-09-18: onboard replaced a working static key with a helper, the vault had no
  // `cornell-ai-gateway` entry, and Desktop lost inference — `helper exited code=1 ... "Element not found.
  // Cannot get credential from Vault"`, stdoutBytes=0. The owner had to restore the static key by hand.
  it("refuses to swap a live credential for a helper when the store has no key; a keyless fresh box still onboards", async () => {
    const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    // the app's own entry: gateway, static key typed into the in-app window
    const appEntry = JSON.stringify({ inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://api.ai.it.cornell.edu", inferenceGatewayApiKey: "typed-by-hand", inferenceCredentialKind: "static" });
    const withKey = await box({ [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] }), [`${L}/${id}.json`]: appEntry });
    secrets(withKey.io, false);   // exit 44: nothing in the store
    const blocked = await desktopInference.detect(withKey.ctx);
    expect(blocked).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/not in the secret store.*static key entered in the app.*stop inference/s) });
    expect((blocked as { reason: string }).reason).toMatch(/bs secrets set cornell-ai-gateway/);
    expect(desktopInference.plan(withKey.ctx, blocked)).toEqual([]);
    expect(withKey.io.writes).toEqual([]);
    // and the apply step refuses even if it is reached from a stale plan
    await expect(desktopInference.apply(withKey.ctx, [{ id: "desktop-inference.entry", title: "" }]))
      .rejects.toThrow(/not in the secret store and Claude Desktop is using/);
    expect(withKey.io.writes).toEqual([]);
    // once the key is there the same box plans normally
    const stored = await box({ [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] }), [`${L}/${id}.json`]: appEntry });
    secrets(stored.io);
    expect((await desktopInference.detect(stored.ctx)).kind).toBe("drifted");
    // a box with nothing to lose is NOT blocked: no applied entry, so an empty store cannot break anything
    const fresh = await box(); secrets(fresh.io, false);
    expect((await desktopInference.detect(fresh.ctx)).kind).toBe("absent");
    await desktopInference.apply(fresh.ctx, desktopInference.plan(fresh.ctx, await desktopInference.detect(fresh.ctx)));
    expect(fresh.io.files.has(`${L}/_meta.json`)).toBe(true);
    expect((await desktopInference.verify(fresh.ctx)).find((c) => c.id === "secret")).toMatchObject({ status: "error" });
  });

  // A foreign helper is someone else's credential path (IT's, or a hand-rolled one) and replacing it has the same
  // failure mode as replacing a static key, so it is gated the same way.
  it("a foreign credential helper is treated as a live credential too", async () => {
    const id = "99999999-9999-4999-8999-999999999999";
    const { ctx } = await box({
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify({ inferenceProvider: "gateway", inferenceGatewayBaseUrl: "https://api.ai.it.cornell.edu", inferenceCredentialKind: "helper-script", inferenceCredentialHelper: "/opt/it/creds.sh" }),
    });
    // no `secrets()` handler: `security` exits non-zero, so the store is empty
    expect(await desktopInference.detect(ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/a credential helper \(\/opt\/it\/creds\.sh\)/) });
  });

  it("blocked: not installed, too old, or a managed source owns the configuration", async () => {
    const none = await makeCtx({ opts, env: { USER: "aca34" } });
    expect(await desktopInference.detect(none.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/not installed/) });
    const old = await makeCtx({ opts, env: { USER: "aca34" }, dirs: [APP], files: { [`${APP}/Contents/Info.plist`]: PLIST.replace("1.49585.0", "1.5354.0") } });
    expect(await desktopInference.detect(old.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/1\.5354\.0 < 1\.19367\.0/) });
    const managed = await box({ "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist" });
    managed.io.on((c) => c === "plutil", () => ({ code: 0, stdout: JSON.stringify({ disableAutoUpdates: true, inferenceProvider: "vertex" }), stderr: "" }));   // plutil -convert json
    expect(await desktopInference.detect(managed.ctx)).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/managed configuration owns Claude Desktop \(\/Library\/Managed Preferences\/com\.anthropic\.claudefordesktop\.plist sets inferenceProvider\).*Configure Third-Party Inference/) });
    const behaviorOnly = await box({ "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist" });
    behaviorOnly.io.on((c) => c === "plutil", () => ({ code: 0, stdout: JSON.stringify({ disableAutoUpdates: true, egressProxyUrl: { host: "proxy", port: 8080 } }), stderr: "" }));   // a nested dict under an app-behavior key is still not a takeover
    expect((await desktopInference.detect(behaviorOnly.ctx)).kind).toBe("absent");
  });

  it("apply refuses to touch the library while Desktop is running; the helper step still runs", async () => {
    const { ctx, io } = await box(); secrets(io);
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "2590\n", stderr: "" }));
    const s = await desktopInference.detect(ctx);
    expect(s.details).toContain(`${D.running} — quit it before applying (the configuration is read at launch)`);
    const steps = desktopInference.plan(ctx, s);
    await desktopInference.apply(ctx, [steps[0]]);
    expect(io.files.has(HELPER)).toBe(true);
    await expect(desktopInference.apply(ctx, [steps[1]])).rejects.toThrow(/Claude Desktop is running — quit it/);
    expect(io.files.has(`${L}/_meta.json`)).toBe(false);
  });

  it("verify: probes GET <base>/v1/models with the stored key in-process; statuses map to ok/error/warn; the key never appears", async () => {
    const { ctx, io, events } = await box(); secrets(io);
    await desktopInference.apply(ctx, desktopInference.plan(ctx, await desktopInference.detect(ctx)));
    io.onFetch((u) => u === "https://api.ai.it.cornell.edu/v1/models", (_u, init) => init.headers?.Authorization === "Bearer s3cr3t-val" ? { status: 200, body: JSON.stringify({ data: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5" }] }) } : { status: 401, body: "" });
    const ok = Object.fromEntries((await desktopInference.verify(ctx)).map((c) => [c.id, c]));
    expect(ok.installed).toMatchObject({ status: "ok" }); expect(ok.version).toMatchObject({ status: "ok" }); expect(ok.managed).toMatchObject({ status: "ok" });
    expect(ok.entry).toMatchObject({ status: "ok", message: expect.stringMatching(/boot-slapper entry applied/) });
    expect(ok.helper).toMatchObject({ status: "ok" }); expect(ok.secret).toMatchObject({ status: "ok" });
    expect(ok.models).toEqual({ id: "models", status: "ok", message: "gateway https://api.ai.it.cornell.edu lists 2 model(s)" });
    expect(io.fetches).toHaveLength(1);
    expect(io.writes.filter((w) => !w.startsWith("/h/.config/boot-slapper") && !w.startsWith(L))).toEqual([]);
    // ruling 5: FakeIo.onFetch is first-match, so stacking a 401 catch-all on this `io` would never
    // beat the exact-URL 200 handler already registered above. Use a fresh fixture for the 401 case,
    // the same way the down/nokey cases below already do.
    const denied = await box(); secrets(denied.io);
    denied.io.onFetch(() => true, () => ({ status: 401, body: "" }));
    expect((await desktopInference.verify(denied.ctx)).find((c) => c.id === "models")).toMatchObject({ status: "error", message: expect.stringMatching(/rejected the stored key \(HTTP 401\)/) });
    const down = await box(); secrets(down.io);
    expect((await desktopInference.verify(down.ctx)).find((c) => c.id === "models")).toMatchObject({ status: "warn", message: expect.stringMatching(/unreachable/) });
    const nokey = await box(); secrets(nokey.io, false);
    const nk = Object.fromEntries((await desktopInference.verify(nokey.ctx)).map((c) => [c.id, c.status]));
    expect(nk.secret).toBe("error"); expect(nk.models).toBe("warn");
    expect(leak(io, events)).toBe(false);
    expect(JSON.stringify(await desktopInference.verify(ctx))).not.toContain("s3cr3t-val");
  });
});

describe("desktop-inference (win32)", () => {
  it("MSIX install, .ps1 helper, LOCALAPPDATA library, reg-query managed probe", async () => {
    const home = "C:\\Users\\t"; const lad = `${home}\\AppData\\Local`;
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", LOCALAPPDATA: lad } });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "Claude_pzs8sxrjxfjjc\t2.110.0.0\r\n", stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    // makeCtx probes the env — and so the install — before these handlers exist; win32 discovery is an exec now.
    resetDesktopProbeCache(io);
    // reg semantics per engine/desktop.ts's fail-closed managedSources (Task 1, commit 6feb1ca): a query
    // failure only reads as "hive genuinely absent" with this exact Windows error text (see
    // tests/unit/engine/desktop.test.ts); any other non-zero exit is treated as unreadable and blocks.
    const REG_KEY_ABSENT = "ERROR: The system was unable to find the specified registry key or value.";
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 1, stdout: "", stderr: REG_KEY_ABSENT }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 1, stdout: "", stderr: REG_KEY_ABSENT }));
    const s = await desktopInference.detect(ctx);
    expect(s.kind).toBe("absent");
    await desktopInference.apply(ctx, desktopInference.plan(ctx, s));
    const helper = `${home}\\.config\\boot-slapper\\desktop-inference-credential.ps1`;
    // ruling 2: the artifact bakes defaultAccount(io) into the helper. Here USER is unset and
    // USERNAME is "t", so defaultAccount(io) === "t" — the helper resolves the account statically
    // to 't' rather than reading $env:USERNAME at runtime.
    expect(io.files.get(helper)).toContain("$c = $v.Retrieve('cornell-ai-gateway', 't')");
    const meta = JSON.parse(io.files.get(`${lad}\\Claude-3p\\configLibrary\\_meta.json`)!);
    const doc = JSON.parse(io.files.get(`${lad}\\Claude-3p\\configLibrary\\${meta.appliedId}.json`)!);
    expect(doc.inferenceCredentialHelper).toBe(helper);
    expect(await desktopInference.detect(ctx)).toEqual({ kind: "present" });
  });
});
