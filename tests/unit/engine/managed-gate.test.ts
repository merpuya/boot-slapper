import { describe, expect, it } from "vitest";
import { managedSources, managedTakeover } from "../../../src/engine/desktop.ts";
import { MANAGED_REFUSAL, managedGate } from "../../../src/engine/managed-gate.ts";
import { managedMacProfile, managedWinHklm, personalMac3pAlready, personalMacSignedIn, personalWinSignedIn, policyUnreadable } from "../migration-fixtures.ts";

describe("managed-machine gate (spec section 5)", () => {
  it("passes the personal fixtures", async () => {
    for (const f of [personalMacSignedIn(), personalWinSignedIn(), personalMac3pAlready()]) {
      const g = await managedGate(f.io, f.io.platform === "win32" ? "win32" : "darwin");
      expect(g, f.name).toMatchObject({ verdict: "clean", message: null });
    }
  });
  it("refuses a managed Windows HKLM policy and a managed macOS profile with the managed message", async () => {
    const w = managedWinHklm(); const m = managedMacProfile();
    const gw = await managedGate(w.io, "win32"); const gm = await managedGate(m.io, "darwin");
    expect(gw.verdict).toBe("managed"); expect(gm.verdict).toBe("managed");
    expect(gw.message).toContain(MANAGED_REFUSAL); expect(gm.message).toContain(MANAGED_REFUSAL);
    expect(gw.detail).toMatch(/HKLM\\SOFTWARE\\Policies\\Claude sets/);
  });
  it("an unreadable policy source is managed-unknown: refuse with a could-not-verify message, never proceed", async () => {
    const f = policyUnreadable();
    const g = await managedGate(f.io, "darwin");
    expect(g.verdict).toBe("unknown");
    expect(g.message).toMatch(/could not verify/i);
    expect(g.message).not.toContain(MANAGED_REFUSAL);
  });
  it("agrees with managedTakeover on every fixture (clean iff no takeover)", async () => {
    for (const [f, os] of [[personalMacSignedIn(), "darwin"], [personalWinSignedIn(), "win32"], [managedWinHklm(), "win32"], [managedMacProfile(), "darwin"], [policyUnreadable(), "darwin"]] as const) {
      const g = await managedGate(f.io, os);
      expect(g.verdict === "clean", f.name).toBe(managedTakeover(await managedSources(f.io, os)) === null);
    }
  });
  it("writes nothing", async () => {
    const f = managedWinHklm(); await managedGate(f.io, "win32");
    expect(f.io.writes).toEqual([]);
  });
});
