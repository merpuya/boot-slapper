import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../../../src/engine/artifact.ts";
import { RealIo } from "../../../src/engine/io.ts";
import { resolveOutDir } from "../../../src/migrate.ts";

/**
 * The --out store guard against a REAL Windows filesystem (the windows-latest CI leg; skipped elsewhere). Everything else tests
 * the Win32 rules against FakeIo with path.win32; this suite is where junctions, 8.3 short names, trailing dots, NTFS directory
 * streams and the loopback admin share meet fs.realpath.native and the real kernel. Each case logs what the OS itself said
 * (`[win32-real-paths] ...`) so a CI log is a record of real-Windows behaviour, not only a pass/fail. A case the runner cannot
 * set up (8.3 names disabled on the volume, no admin share) is skipped with the reason as its note.
 */
const REFUSED = /inside Claude's own data folder/;
const note = (what: string, value: unknown) => console.log(`[win32-real-paths] ${what}: ${JSON.stringify(value)}`);

/** RealIo with APPDATA pointed at a temp folder, so the first-party store the guard protects is one this suite created. */
class SandboxIo extends RealIo {
  override readonly env: Record<string, string | undefined>;
  constructor(appData: string) { super(); this.env = { ...process.env, APPDATA: appData }; }
}

describe.runIf(process.platform === "win32")("resolveOutDir on a real Windows filesystem", () => {
  let root = "", roaming = "", store = "", docs = "";
  let io: SandboxIo;
  let ctx: Ctx;
  const refused = async (out: string) => {
    const r = await resolveOutDir(ctx, out);
    expect("error" in r ? r.error : `accepted ${out}`, out).toMatch(REFUSED);
  };

  beforeAll(() => {
    // realpathSync.native: the runner's temp folder is itself an 8.3 spelling (C:\Users\RUNNER~1\...), and the store must be long-form.
    root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "bs-win32-")));
    roaming = path.join(root, "RoamingProfileFolder");   // longer than 8.3, so the volume (if it generates 8.3 names) gives it a short one
    store = path.join(roaming, "Claude");
    docs = path.join(root, "Documents");
    mkdirSync(store, { recursive: true }); mkdirSync(docs);
    io = new SandboxIo(roaming);
    ctx = { env: { os: "win32", home: root }, io } as unknown as Ctx;
    note("store", store); note("hostname", io.hostname);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it("control: accepts an ordinary folder next to the store and refuses the store itself", async () => {
    expect(await resolveOutDir(ctx, path.join(docs, "mine"))).toEqual({ dir: path.join(docs, "mine") });
    await refused(store); await refused(path.join(store, "sub"));
  });

  it("refuses a junction into the store, and a dangling junction whose target inside the store does not exist yet", async () => {
    symlinkSync(store, path.join(docs, "j"), "junction");
    symlinkSync(path.join(store, "not-yet"), path.join(docs, "later"), "junction");
    note("realpath.native(junction)", await io.realpath(path.join(docs, "j")));
    note("realpath.native(dangling junction)", await io.realpath(path.join(docs, "later")));
    note("readlink(dangling junction)", await io.readlink(path.join(docs, "later")));
    await refused(path.join(docs, "j")); await refused(path.join(docs, "j", "sub"));
    await refused(path.join(docs, "later")); await refused(path.join(docs, "later", "x"));
  });

  it("refuses the store reached through an 8.3 short name", { timeout: 60_000 }, async (t) => {
    let short = "";
    try {
      short = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${roaming}').ShortPath`], { encoding: "utf8", timeout: 45_000 }).trim();
    } catch (e) { t.skip(`could not ask the OS for the short name: ${(e as Error).message.split("\n")[0]}`); }
    note("8.3 short path of the store's parent", short);
    if (!short || path.basename(short).toLowerCase() === path.basename(roaming).toLowerCase()) t.skip(`8.3 name generation is off on this volume (short path ${JSON.stringify(short)})`);
    note("realpath.native(short\\Claude)", await io.realpath(path.join(short, "Claude")));
    await refused(path.join(short, "Claude")); await refused(path.join(short, "Claude", "x"));
  });

  it("refuses trailing-dot and trailing-space spellings of the store", async () => {
    for (const p of [`${store}.`, `${store} `, `${store}.\\x`]) note(`realpath.native(${JSON.stringify(p)})`, await io.realpath(p));
    await refused(`${store}.`); await refused(`${store} `); await refused(`${store}.\\x`);
  });

  it("refuses the store spelled with an NTFS directory-stream suffix", async () => {
    for (const s of ["::$INDEX_ALLOCATION", ":$I30:$INDEX_ALLOCATION", ":$I30"]) {
      let isDir: unknown;
      try { isDir = statSync(store + s).isDirectory(); } catch (e) { isDir = (e as NodeJS.ErrnoException).code; }
      note(`stat(store${s}).isDirectory()`, isDir);
      note(`realpath.native(store${s})`, await io.realpath(store + s));
      await refused(store + s); await refused(`${store}${s}\\x`);
    }
  });

  it("refuses the store through the loopback admin share", async (t) => {
    const drive = store[0]!.toUpperCase();
    const viaShare = (host: string) => `\\\\${host}\\${drive}$${store.slice(2)}`;
    try { statSync(viaShare("localhost")); }
    catch (e) { t.skip(`\\\\localhost\\${drive}$ is not reachable on this runner (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`); }
    note("realpath.native(\\\\localhost\\<drive>$\\...store)", await io.realpath(viaShare("localhost")));
    for (const host of ["localhost", "127.0.0.1", "127.0.0.2", "127.1", "::1", "--1.ipv6-literal.net", io.hostname]) await refused(viaShare(host));
  });
});
