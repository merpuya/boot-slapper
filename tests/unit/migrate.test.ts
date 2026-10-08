import { describe, expect, it } from "vitest";
import { main } from "../../src/cli.ts";
import { MANAGED_REFUSAL, SUPPORT_CONTACT } from "../../src/engine/managed-gate.ts";
import { CHECKLIST_MARKER } from "../../src/artifacts/legacy-subscription.ts";
import { ALL_FIXTURES, SECRET_LOOKING, type Fixture } from "./migration-fixtures.ts";

const sink = () => { const lines: string[] = []; return { lines, write: (l: string) => lines.push(l) }; };
const run = async (f: Fixture, args: string[]) => {
  const out = sink(); const err = sink();
  const code = await main([...args, "--profile", "cornell-faculty", "--headless", "--auto"], { io: f.io, stdout: out, stderr: err });
  return { code, out: out.lines.join("\n"), err: err.lines.join("\n") };
};
const MANAGED = ["managedWinHklm", "managedMacProfile", "policyUnreadable"] as const;
const outFor = (f: Fixture) => (f.io.platform === "win32" ? "C:\\Users\\t\\Documents\\claude-migration" : "/h/Documents/claude-migration");
const sep = (f: Fixture) => (f.io.platform === "win32" ? "\\" : "/");

describe("bs onboard --profile cornell-faculty on a managed machine", () => {
  for (const k of MANAGED) {
    it(`${k}: refuses, exits non-zero, writes nothing (even before the gateway-URL guard)`, async () => {
      const f = ALL_FIXTURES[k]();
      const r = await run(f, ["onboard"]);
      expect(r.code).toBe(4);
      expect(r.err).toContain(SUPPORT_CONTACT);
      expect(r.err).toMatch(k === "policyUnreadable" ? /could not verify/i : new RegExp(MANAGED_REFUSAL.replace(/[.']/g, "\\$&")));
      expect(r.err).not.toMatch(/--force|override/i);
      expect(f.io.writes).toEqual([]);
      expect(r.out).toBe("");
    });
  }
  it("a refusal with --gateway-url given is the same refusal", async () => {
    const f = ALL_FIXTURES.managedMacProfile();
    expect((await run(f, ["onboard", "--gateway-url", "https://gw.test.example"])).code).toBe(4);
    expect(f.io.writes).toEqual([]);
  });
  for (const k of ["personalMacSignedIn", "personalWinSignedIn", "personalMac3pAlready"] as const) {
    it(`${k}: is not refused by the gate`, async () => {
      const f = ALL_FIXTURES[k]();
      const r = await run(f, ["onboard"]);
      expect(r.err).not.toContain(MANAGED_REFUSAL);
      expect(r.code).toBe(2);   // stops at the .invalid gateway-URL guard instead; nothing written
      expect(f.io.writes).toEqual([]);
    });
  }
});

describe("bs migrate --checklist-only", () => {
  for (const k of ["personalMacSignedIn", "personalWinSignedIn", "personalMac3pAlready"] as const) {
    it(`${k}: writes instructions.md in the default folder and nothing else`, async () => {
      const f = ALL_FIXTURES[k]();
      const r = await run(f, ["migrate", "--checklist-only"]);
      expect(r.code).toBe(0);
      const target = `${outFor(f)}${sep(f)}instructions.md`;
      expect(f.io.writes).toEqual([target]);
      const md = f.io.files.get(target)!;
      expect(md.startsWith(CHECKLIST_MARKER)).toBe(true);
      expect(md).toMatch(/zotero/); expect(md).not.toContain(SECRET_LOOKING);
      expect(r.out).toContain(target);
      expect(r.out).toMatch(/account is untouched/i);
      expect(f.io.writes.some((w) => w.startsWith(f.firstParty))).toBe(false);
    });
  }
  for (const k of MANAGED) {
    it(`${k}: still allowed (read-only, useful on managed boxes), says the box is managed, and writes only instructions.md`, async () => {
      const f = ALL_FIXTURES[k]();
      const r = await run(f, ["migrate", "--checklist-only"]);
      expect(r.code).toBe(0);
      expect(f.io.writes).toEqual([`${outFor(f)}${sep(f)}instructions.md`]);
      expect(r.out + r.err).toMatch(k === "policyUnreadable" ? /could not verify/i : /managed by your organisation/);
    });
  }
  it("honours --out", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    expect((await run(f, ["migrate", "--checklist-only", "--out", "/tmp/mine"])).code).toBe(0);
    expect(f.io.writes).toEqual(["/tmp/mine/instructions.md"]);
  });
  it("expands a leading ~ in --out against the home folder", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    expect((await run(f, ["migrate", "--checklist-only", "--out", "~/saved"])).code).toBe(0);
    expect(f.io.writes).toEqual(["/h/saved/instructions.md"]);
  });
  it("refuses an --out inside the first-party Claude store, and writes nothing", async () => {
    for (const k of ["personalMacSignedIn", "personalWinSignedIn"] as const) {
      const f = ALL_FIXTURES[k]();
      for (const out of [f.firstParty, `${f.firstParty}${sep(f)}sub`]) {
        const r = await run(f, ["migrate", "--checklist-only", "--out", out]);
        expect(r.code).toBe(2); expect(r.err).toMatch(/inside Claude's own data folder/);
        expect(f.io.writes).toEqual([]);
      }
    }
  });
  it("re-running regenerates only its own file (identical bytes) and refuses to overwrite a foreign instructions.md", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    await run(f, ["migrate", "--checklist-only"]);
    const target = "/h/Documents/claude-migration/instructions.md"; const first = f.io.files.get(target);
    expect((await run(f, ["migrate", "--checklist-only"])).code).toBe(0);
    expect(f.io.files.get(target)).toBe(first);
    const g = ALL_FIXTURES.personalMacSignedIn();
    g.io.files.set(target, "my own notes\n"); g.io.dirs.add("/h/Documents/claude-migration");
    const r = await run(g, ["migrate", "--checklist-only"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not written by this tool/);
    expect(g.io.files.get(target)).toBe("my own notes\n");
    expect(g.io.writes).toEqual([]);
  });
  it("stops without writing if the checklist would contain a secret-shaped string", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    f.io.files.set(`${f.firstParty}/claude_desktop_config.json`, JSON.stringify({ mcpServers: { [SECRET_LOOKING]: { command: "x" } } }));
    const r = await run(f, ["migrate", "--checklist-only"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/secret-shaped/);
    expect(f.io.writes).toEqual([]);
  });
});

describe("bs migrate (without --checklist-only)", () => {
  it("on a managed box refuses with the managed message, exit non-zero, writes nothing", async () => {
    for (const k of MANAGED) {
      const f = ALL_FIXTURES[k](); const r = await run(f, ["migrate"]);
      expect(r.code, k).toBe(4); expect(r.err, k).toContain(SUPPORT_CONTACT); expect(f.io.writes, k).toEqual([]);
    }
  });
  it("on a personal box says the capture-pause-onboard flow is not built yet and writes nothing", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn(); const r = await run(f, ["migrate"]);
    expect(r.code).toBe(2); expect(r.err).toMatch(/--checklist-only/); expect(f.io.writes).toEqual([]);
  });
  it("needs a profile with the legacy-subscription artifact", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn(); const out = sink(); const err = sink();
    expect(await main(["migrate", "--checklist-only"], { io: f.io, stdout: out, stderr: err })).toBe(2);
    expect(err.lines.join("\n")).toMatch(/cornell-faculty/); expect(f.io.writes).toEqual([]);
  });
});
