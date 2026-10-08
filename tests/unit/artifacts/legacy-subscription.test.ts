import { describe, expect, it } from "vitest";
import { legacyFacts, legacySubscription, renderChecklist, CHECKLIST_MARKER } from "../../../src/artifacts/legacy-subscription.ts";
import { withOpts, type Ctx } from "../../../src/engine/artifact.ts";
import { scanForSecrets } from "../../../src/engine/capture.ts";
import { buildCtx } from "../../../src/engine/ctx.ts";
import { cornellFaculty } from "../../../src/profiles/cornell-faculty.ts";
import { ALL_FIXTURES, SECRET_LOOKING, type Fixture } from "../migration-fixtures.ts";

const ctxOf = (f: Fixture): Promise<Ctx> => buildCtx(f.io, cornellFaculty, { interactive: false, prompt: { secret: async () => "", text: async () => "", confirm: async () => true, gate: async () => {} }, emit: () => {} });
const hosted = cornellFaculty.options["hosted-connectors"] as { connectors: string[]; features: string[] };

describe("legacy-subscription (read-only source-side detect; store presence is the Q4 default)", () => {
  it("personal-mac-signed-in: finds the first-party store, skills in both places, local MCP names, a Code subscription", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    const facts = await legacyFacts(await ctxOf(f));
    expect(facts).toMatchObject({ firstPartyStore: f.firstParty, firstPartyPresent: true, thirdPartyAlready: false, codeSubscription: true });
    expect(facts.skills).toEqual([
      { name: "grant-notes", where: "cowork-store" }, { name: "lit-review", where: "cowork-store" }, { name: "old-helper", where: "kb-folder" },
    ]);
    expect(facts.mcpServers).toEqual({ names: ["filesystem", "zotero"], unreadable: false });
  });
  it("personal-win-signed-in: reads the roaming first-party store and the %USERPROFILE%\\Claude KB folder", async () => {
    const f = ALL_FIXTURES.personalWinSignedIn();
    const facts = await legacyFacts(await ctxOf(f));
    expect(facts).toMatchObject({ firstPartyStore: f.firstParty, firstPartyPresent: true, thirdPartyAlready: false, codeSubscription: false });
    expect(facts.skills).toEqual([{ name: "lit-review", where: "cowork-store" }, { name: "old-helper", where: "kb-folder" }]);
    expect(facts.mcpServers.names).toEqual(["filesystem", "zotero"]);
  });
  it("personal-mac-3p-already: reports a third-party configuration already in place", async () => {
    const facts = await legacyFacts(await ctxOf(ALL_FIXTURES.personalMac3pAlready()));
    expect(facts).toMatchObject({ firstPartyPresent: true, thirdPartyAlready: true });
  });
  it("still reports on managed and unreadable-policy boxes (it never needs the gate; it only reads)", async () => {
    for (const mk of [ALL_FIXTURES.managedWinHklm, ALL_FIXTURES.managedMacProfile, ALL_FIXTURES.policyUnreadable]) {
      const f = mk(); const facts = await legacyFacts(await ctxOf(f));
      expect(facts.firstPartyPresent, f.name).toBe(true);
      expect(facts.mcpServers.names, f.name).toEqual(["filesystem", "zotero"]);
    }
  });
  it("an empty machine finds nothing and says so; an unparseable desktop config is flagged unreadable, not empty", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    f.io.files.set(`${f.firstParty}/claude_desktop_config.json`, "{not json");
    expect((await legacyFacts(await ctxOf(f))).mcpServers).toEqual({ names: [], unreadable: true });
    const g = ALL_FIXTURES.personalMacSignedIn();
    for (const k of [...g.io.files.keys()]) if (k.startsWith(g.firstParty) || k.startsWith("/h/Documents") || k === "/h/.claude.json") g.io.files.delete(k);
    for (const d of [...g.io.dirs]) if (d.startsWith(g.firstParty) || d.startsWith("/h/Documents")) g.io.dirs.delete(d);
    const facts = await legacyFacts(await ctxOf(g));
    expect(facts).toMatchObject({ firstPartyPresent: false, codeSubscription: false, skills: [] });
  });

  describe("contract: detect/verify/capture only read, in every fixture", () => {
    for (const [name, mk] of Object.entries(ALL_FIXTURES)) {
      it(name, async () => {
        const f = mk(); const ctx = withOpts(await ctxOf(f), undefined);
        const state = await legacySubscription.detect(ctx);
        expect(legacySubscription.plan(ctx, state as never)).toEqual([]);
        await legacySubscription.apply(ctx, []);
        const checks = await legacySubscription.verify(ctx);
        expect(checks.every((c) => c.status === "info")).toBe(true);
        const b = await legacySubscription.capture!(ctx);
        expect(b.files).toEqual([]);
        expect(f.io.writes).toEqual([]);
        for (const c of f.io.calls) expect(c.cmd === "powershell" && c.args.some((a) => a.includes("Get-AppxPackage")), `${f.name}: ${c.cmd} ${c.args.join(" ")}`).toBe(true);   // the only probe is the Desktop install lookup
        expect(f.io.fetches).toEqual([]);
      });
    }
  });
});

describe("renderChecklist (instructions.md)", () => {
  it("lists the seven items, names MCP servers and skills, and never prints a value", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    const md = renderChecklist(await legacyFacts(await ctxOf(f)), hosted);
    expect(md.startsWith(CHECKLIST_MARKER)).toBe(true);
    for (const h of [/^## 1\. Conversation history/m, /^## 2\. Projects/m, /^## 3\. Uploaded files/m, /^## 4\. Custom instructions/m, /^## 5\. Skills found on this computer/m, /^## 6\. Local MCP servers/m, /^## 7\. Connectors that stay on claude\.ai/m]) expect(md).toMatch(h);
    expect(md).toMatch(/- \[ \] .*zotero/); expect(md).toMatch(/- \[ \] .*filesystem/);
    expect(md).toMatch(/lit-review/); expect(md).toMatch(/old-helper/);
    expect(md).toMatch(/Export data/);
    expect(md).toMatch(/Gmail, Google Calendar, Google Drive/);
    expect(md).toMatch(/account is untouched/i);
    expect(md).not.toContain(SECRET_LOOKING);
    expect(md).not.toMatch(/API_TOKEN|npx|zotero-mcp/);   // no env key names, commands or args
    expect(scanForSecrets([{ path: "instructions.md", content: md }])).toEqual([]);
  });
  it("is deterministic (re-running yields identical text) and says when it found nothing", async () => {
    const f = ALL_FIXTURES.personalMacSignedIn();
    const facts = await legacyFacts(await ctxOf(f));
    expect(renderChecklist(facts, hosted)).toBe(renderChecklist(facts, hosted));
    const none = renderChecklist({ ...facts, skills: [], mcpServers: { names: [], unreadable: false }, firstPartyPresent: false, codeSubscription: false }, hosted);
    expect(none).toMatch(/No Claude Desktop data from a personal account was found/);
    expect(none).toMatch(/none found/i);
  });
  it("flags an unreadable local config and a 3P-already box in plain language", async () => {
    const facts = await legacyFacts(await ctxOf(ALL_FIXTURES.personalMac3pAlready()));
    expect(renderChecklist(facts, hosted)).toMatch(/already set up to use a third-party/i);
    expect(renderChecklist({ ...facts, mcpServers: { names: [], unreadable: true } }, hosted)).toMatch(/could not be read/i);
  });
  it("states that sign-in status is not checked (store presence only)", async () => {
    const md = renderChecklist(await legacyFacts(await ctxOf(ALL_FIXTURES.personalMacSignedIn())), hosted);
    expect(md).toMatch(/does not check whether you are signed in/i);
  });
});
