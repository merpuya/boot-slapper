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
