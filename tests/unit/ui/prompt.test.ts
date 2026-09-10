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
