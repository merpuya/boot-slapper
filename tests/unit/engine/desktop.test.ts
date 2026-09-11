import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import {
  cfgGet, configLibraryDir, decodeAntDid, desktopDataDir, desktopInstall, desktopRunning, managedSources, managedTakeover,
  ourEntry, readLibraryMeta, readSidecar, resetDesktopProbeCache, upsertMeta, versionAtLeast, writeLibraryEntry, writeSidecar, ENTRY_NAME,
} from "../../../src/engine/desktop.ts";

// managedSources converts with `plutil -convert json`, so a stub returns the document as JSON — an XML
// scan for <key> also picked up nested keys and read them as a managed takeover.
const PLIST = (keys: Record<string, unknown>) => JSON.stringify(keys);
const INFO = `<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string><key>CFBundleIdentifier</key><string>com.anthropic.claudefordesktop</string></dict></plist>`;

describe("engine/desktop paths", () => {
  it("resolves the Claude-3p data dir per OS (LOCALAPPDATA wins on win32)", () => {
    expect(desktopDataDir(new FakeIo(), "darwin", "/h")).toBe("/h/Library/Application Support/Claude-3p");
    expect(desktopDataDir(new FakeIo({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\t\\AppData\\Local" } }), "win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\Claude-3p");
    expect(desktopDataDir(new FakeIo({ platform: "win32" }), "win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Local\\Claude-3p");
    expect(desktopDataDir(new FakeIo(), "linux", "/h")).toBe("/h/.config/Claude-3p");
    expect(configLibraryDir(new FakeIo(), "darwin", "/h")).toBe("/h/Library/Application Support/Claude-3p/configLibrary");
  });
});

describe("desktopInstall", () => {
  it("darwin: reads the version from Info.plist without exec", async () => {
    const io = new FakeIo({ dirs: ["/Applications/Claude.app"], files: { "/Applications/Claude.app/Contents/Info.plist": INFO } });
    expect(await desktopInstall(io, "darwin", "/h")).toEqual({ installed: true, path: "/Applications/Claude.app", version: "1.49585.0" });
    expect(io.calls).toEqual([]);
    expect(await desktopInstall(new FakeIo(), "darwin", "/h")).toEqual({ installed: false, path: "/Applications/Claude.app", version: null });
  });
  it("win32: the MSIX package dir counts as installed; version via Get-AppxPackage; legacy exe still recognised", async () => {
    const home = "C:\\Users\\t";
    const io = new FakeIo({ platform: "win32", home, env: { LOCALAPPDATA: `${home}\\AppData\\Local` }, dirs: [`${home}\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`] });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    expect(await desktopInstall(io, "win32", home)).toEqual({ installed: true, path: `${home}\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`, version: "1.49585.0" });
    const legacy = new FakeIo({ platform: "win32", home, files: { [`${home}\\AppData\\Local\\AnthropicClaude\\claude.exe`]: "" } });
    legacy.on((c) => c === "powershell", () => ({ code: 1, stdout: "", stderr: "" }));
    expect(await desktopInstall(legacy, "win32", home)).toEqual({ installed: true, path: `${home}\\AppData\\Local\\AnthropicClaude\\claude.exe`, version: null });
  });
  it("versionAtLeast compares dotted numbers", () => {
    expect(versionAtLeast("1.49585.0", "1.19367.0")).toBe(true);
    expect(versionAtLeast("1.19367.0", "1.19367.0")).toBe(true);
    expect(versionAtLeast("1.5354.0", "1.19367.0")).toBe(false);
    expect(versionAtLeast(null, "1.19367.0")).toBe(false);
  });
});

describe("managed sources", () => {
  it("darwin: converts each existing managed plist with plutil and lists its keys; only app-behavior keys → no takeover", async () => {
    const io = new FakeIo({ env: { USER: "aca34" }, files: { "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist": "bplist", "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist": "bplist" } });
    io.on((c, a) => c === "plutil" && a.includes("-convert"), ({ args }) => ({ code: 0, stdout: PLIST(args.at(-1)!.includes("/aca34/") ? { disableAutoUpdates: true } : { disableAutoUpdates: true, autoUpdaterEnforcementHours: 24 }), stderr: "" }));
    const s = await managedSources(io, "darwin");
    expect(s).toEqual([
      { source: "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist", keys: ["disableAutoUpdates"], readable: true },
      { source: "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist", keys: ["disableAutoUpdates", "autoUpdaterEnforcementHours"], readable: true },
    ]);
    expect(io.calls.every((c) => c.cmd === "plutil" && c.args[0] === "-convert" && c.args[1] === "json" && c.args[2] === "-o" && c.args[3] === "-")).toBe(true);
    expect(managedTakeover(s)).toBeNull();
    expect(managedTakeover([{ source: "x.plist", keys: ["disableAutoUpdates", "inferenceProvider"], readable: true }])).toBe("x.plist sets inferenceProvider");
  });
  it("darwin: only *top-level* keys count — a nested dict under an app-behavior key is not a takeover", async () => {
    const p = "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist";
    const io = new FakeIo({ env: { USER: "aca34" }, files: { [p]: "bplist" } });
    io.on((c) => c === "plutil", () => ({ code: 0, stdout: PLIST({ disableAutoUpdates: true, egressProxyUrl: { nested: 1 } }), stderr: "" }));
    const s = await managedSources(io, "darwin");
    expect(s).toEqual([{ source: p, keys: ["disableAutoUpdates", "egressProxyUrl"], readable: true }]);
    expect(managedTakeover(s)).toBeNull();
  });
  it("darwin: plutil output that is not a JSON object is unreadable (fails the takeover check closed)", async () => {
    const p = "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist";
    const io = new FakeIo({ env: { USER: "aca34" }, files: { [p]: "bplist" } });
    io.on((c) => c === "plutil", () => ({ code: 0, stdout: "[1,2]", stderr: "" }));
    const s = await managedSources(io, "darwin");
    expect(s).toEqual([{ source: p, keys: [], readable: false }]);
    expect(managedTakeover(s)).toBe(`could not read ${p}`);
  });
  it("darwin: an unconvertible managed plist is reported unreadable, and that fails the takeover check closed", async () => {
    const p = "/Library/Managed Preferences/aca34/com.anthropic.claudefordesktop.plist";
    const io = new FakeIo({ env: { USER: "aca34" }, files: { [p]: "bplist" } });
    io.on((c, a) => c === "plutil" && a.includes("-convert"), () => ({ code: 1, stdout: "", stderr: "plutil: could not convert" }));
    const s = await managedSources(io, "darwin");
    expect(s).toEqual([{ source: p, keys: [], readable: false }]);
    expect(managedTakeover(s)).toBe(`could not read ${p}`);
  });
  it("win32: HKLM values own the device; HKCU is consulted only when HKLM is empty", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 0, stdout: "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude\r\n    disableAutoUpdates    REG_SZ    true\r\n\r\n", stderr: "" }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 0, stdout: "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n\r\n", stderr: "" }));
    expect(await managedSources(io, "win32")).toEqual([{ source: "HKLM\\SOFTWARE\\Policies\\Claude", keys: ["disableAutoUpdates"], readable: true }]);
    // HKLM genuinely absent ("unable to find the specified registry key") falls through to HKCU, unchanged.
    const empty = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    empty.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." }));
    empty.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 0, stdout: "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n\r\n", stderr: "" }));
    const s = await managedSources(empty, "win32");
    expect(s).toEqual([{ source: "HKCU\\SOFTWARE\\Policies\\Claude", keys: ["inferenceProvider"], readable: true }]);
    expect(managedTakeover(s)).toBe("HKCU\\SOFTWARE\\Policies\\Claude sets inferenceProvider");
  });
  it("win32: an HKLM reg-query failure other than \"key not found\" is reported unreadable and does not fall through to HKCU", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 5, stdout: "", stderr: "ERROR: Access is denied." }));
    io.on((c, a) => c === "reg" && a[1].startsWith("HKCU"), () => ({ code: 0, stdout: "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ    gateway\r\n\r\n", stderr: "" }));
    const s = await managedSources(io, "win32");
    expect(s).toEqual([{ source: "HKLM\\SOFTWARE\\Policies\\Claude", keys: [], readable: false }]);
    expect(managedTakeover(s)).toBe("could not read HKLM\\SOFTWARE\\Policies\\Claude");
  });
  it("win32: reg query parses a REG_SZ value with no trailing data (an empty string)", async () => {
    const io = new FakeIo({ platform: "win32", home: "C:\\Users\\t" });
    io.on((c, a) => c === "reg" && a[1].startsWith("HKLM"), () => ({ code: 0, stdout: "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Claude\r\n    inferenceProvider    REG_SZ\r\n\r\n", stderr: "" }));
    const s = await managedSources(io, "win32");
    expect(s).toEqual([{ source: "HKLM\\SOFTWARE\\Policies\\Claude", keys: ["inferenceProvider"], readable: true }]);
  });
  it("desktopInstall and managedSources are memoized per Io; desktopRunning never is; resetDesktopProbeCache clears them", async () => {
    const home = "C:\\Users\\t";
    const io = new FakeIo({ platform: "win32", home, env: { LOCALAPPDATA: `${home}\\AppData\\Local` }, dirs: [`${home}\\AppData\\Local\\Packages\\AnthropicPBC.Claude_fnn82j28hfe8t`] });
    io.on((c, a) => c === "powershell" && a.some((x) => x.includes("Get-AppxPackage")), () => ({ code: 0, stdout: "1.49585.0\r\n", stderr: "" }));
    io.on((c) => c === "reg", () => ({ code: 1, stdout: "", stderr: "ERROR: The system was unable to find the specified registry key or value." }));
    io.on((c) => c === "tasklist", () => ({ code: 0, stdout: "Claude.exe   1234 Console   1   300,000 K\r\n", stderr: "" }));
    const first = await desktopInstall(io, "win32", home);
    expect(await desktopInstall(io, "win32", home)).toEqual(first);
    expect(io.calls.filter((c) => c.cmd === "powershell")).toHaveLength(1);     // one 20 s Get-AppxPackage per run, not one per artifact
    await managedSources(io, "win32"); await managedSources(io, "win32");
    expect(io.calls.filter((c) => c.cmd === "reg")).toHaveLength(2);            // HKLM + HKCU, once
    expect(await desktopRunning(io, "win32")).toBe(true);
    expect(await desktopRunning(io, "win32")).toBe(true);
    expect(io.calls.filter((c) => c.cmd === "tasklist")).toHaveLength(2);       // never cached: apply re-checks after the plan screen
    resetDesktopProbeCache(io);
    await desktopInstall(io, "win32", home);
    expect(io.calls.filter((c) => c.cmd === "powershell")).toHaveLength(2);
  });
  it("desktopRunning uses pgrep / tasklist and treats an unhandled probe as not running", async () => {
    const io = new FakeIo();
    io.on((c) => c === "pgrep", () => ({ code: 0, stdout: "2590\n", stderr: "" }));
    expect(await desktopRunning(io, "darwin")).toBe(true);
    expect(await desktopRunning(new FakeIo(), "darwin")).toBe(false);
    const w = new FakeIo({ platform: "win32" });
    w.on((c) => c === "tasklist", () => ({ code: 0, stdout: "Claude.exe                    1234 Console                    1    300,000 K\r\n", stderr: "" }));
    expect(await desktopRunning(w, "win32")).toBe(true);
  });
});

describe("config library", () => {
  const L = "/h/Library/Application Support/Claude-3p/configLibrary";
  it("readLibraryMeta: null when absent, 'invalid' when malformed", async () => {
    expect(await readLibraryMeta(new FakeIo(), "darwin", "/h")).toBeNull();
    expect(await readLibraryMeta(new FakeIo({ files: { [`${L}/_meta.json`]: "{" } }), "darwin", "/h")).toBe("invalid");
    expect(await readLibraryMeta(new FakeIo({ files: { [`${L}/_meta.json`]: '{"appliedId":"a","entries":[{"id":"a","name":"Default"}]}' } }), "darwin", "/h")).toEqual({ appliedId: "a", entries: [{ id: "a", name: "Default" }] });
  });
  it("ourEntry finds the boot-slapper entry by sidecar id first, then by name; null when neither", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const io = new FakeIo({ files: {
      [`${L}/_meta.json`]: JSON.stringify({ appliedId: "a", entries: [{ id: "a", name: "Default" }, { id, name: ENTRY_NAME }] }),
      [`${L}/${id}.json`]: JSON.stringify({ $schemaVersion: 2, inference: { provider: "gateway" } }),
      [`${L}/a.json`]: "{}",
    } });
    expect(await ourEntry(io, "darwin", "/h")).toEqual({ id, doc: { $schemaVersion: 2, inference: { provider: "gateway" } }, applied: false });
    await writeSidecar(io, "darwin", "/h", { entryId: id });
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, true);
    expect((await ourEntry(io, "darwin", "/h") as { applied: boolean }).applied).toBe(true);
    expect(await ourEntry(new FakeIo({ files: { [`${L}/_meta.json`]: '{"appliedId":"a","entries":[{"id":"a","name":"Default"}]}' } }), "darwin", "/h")).toBeNull();
  });
  it("writeLibraryEntry writes mode 600 inside a mode-700 dir; upsertMeta adds once and can switch appliedId; sidecar merges", async () => {
    const io = new FakeIo();
    const id = "22222222-2222-4222-8222-222222222222";
    await writeLibraryEntry(io, "darwin", "/h", id, { $schemaVersion: 2 });
    expect(io.files.get(`${L}/${id}.json`)).toBe('{\n  "$schemaVersion": 2\n}\n');
    expect(io.modes.get(`${L}/${id}.json`)).toBe(0o600);
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, false);
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, true);
    expect(JSON.parse(io.files.get(`${L}/_meta.json`)!)).toEqual({ appliedId: id, entries: [{ id, name: ENTRY_NAME }] });
    expect(await writeSidecar(io, "darwin", "/h", { entryId: id })).toEqual({ entryId: id });
    expect(await writeSidecar(io, "darwin", "/h", { servers: ["mecp"] })).toEqual({ entryId: id, servers: ["mecp"] });
    expect(await readSidecar(io, "darwin", "/h")).toEqual({ entryId: id, servers: ["mecp"] });
    expect(io.modes.get("/h/.config/boot-slapper/desktop.json")).toBe(0o600);
  });
  it("upsertMeta preserves keys it does not model — top-level and on a foreign entry", async () => {
    const foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const id = "33333333-3333-4333-8333-333333333333";
    const before = { $schemaVersion: 3, appliedId: foreign, lastOpenedAt: 1757500000000, entries: [{ id: foreign, name: "Default", icon: "🏛", pinned: true }] };
    const io = new FakeIo({ files: { [`${L}/_meta.json`]: JSON.stringify(before, null, 2) + "\n" } });
    await upsertMeta(io, "darwin", "/h", { id, name: ENTRY_NAME }, true);
    const after = JSON.parse(io.files.get(`${L}/_meta.json`)!) as typeof before;
    expect(after.$schemaVersion).toBe(3);
    expect(after.lastOpenedAt).toBe(1757500000000);
    expect(after.entries[0]).toEqual({ id: foreign, name: "Default", icon: "🏛", pinned: true });
    expect(after.entries[1]).toEqual({ id, name: ENTRY_NAME });
    expect(after.appliedId).toBe(id);
  });
  it("cfgGet reads the nested v2 shape or the flat v1 shape; decodeAntDid decodes base64 text", () => {
    expect(cfgGet({ inference: { provider: "gateway" } }, ["inference", "provider"], "inferenceProvider")).toBe("gateway");
    expect(cfgGet({ inferenceProvider: "gateway" }, ["inference", "provider"], "inferenceProvider")).toBe("gateway");
    expect(cfgGet(null, ["inference", "provider"], "inferenceProvider")).toBeUndefined();
    expect(decodeAntDid(Buffer.from("831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f").toString("base64") + "\n")).toBe("831eb16e-46c0-41bd-bc4a-dc72a9bc5a8f");
    expect(decodeAntDid("not-base64!!")).toBeNull();
    expect(decodeAntDid(null)).toBeNull();
  });
});
