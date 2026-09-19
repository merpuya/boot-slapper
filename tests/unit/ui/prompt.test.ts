import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { InteractiveRequired } from "../../../src/engine/artifact.ts";
import { headlessPrompter, ttyPrompter } from "../../../src/ui/prompt.ts";

describe("headlessPrompter", () => {
  it("refuses every prompt kind with InteractiveRequired, including text", async () => {
    const p = headlessPrompter();
    await expect(p.text("device id", "x")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.secret("s")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.confirm("c")).rejects.toBeInstanceOf(InteractiveRequired);
    await expect(p.gate("g")).rejects.toBeInstanceOf(InteractiveRequired);
  });
});

/** A tty-shaped stream pair, plus everything written to the output side. */
function fakeTty() {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: () => void };
  input.isTTY = true; input.setRawMode = () => {};
  const output = new PassThrough() as PassThrough & { isTTY?: boolean };
  output.isTTY = true;
  let written = "";
  output.on("data", (c: Buffer) => { written += c.toString(); });
  return { input, output, seen: () => written };
}

describe("ttyPrompter", () => {
  // yogaNovo 2026-09-18: `bs secrets set` sat at a blank line with no visible prompt, so it looked like
  // it had exited. The prompt WAS written, then erased — readline was given "" as its prompt, so it
  // redrew an empty line (ESC[1G ESC[0J = cursor to column 1, erase to end of screen) over the text
  // written by hand. PowerShell lost the race every time. Both halves are pinned here: the label must
  // survive, and the typed secret must never be echoed.
  it("secret: the prompt is visible and the typed value is not echoed", async () => {
    const { input, output, seen } = fakeTty();
    const answered = ttyPrompter({ input, output }).secret("Paste mecp-device-token");
    await new Promise((r) => setImmediate(r));
    expect(seen()).toContain("Paste mecp-device-token");     // the regression: this used to be erased
    input.write("s3cr3t-token\n");
    expect(await answered).toBe("s3cr3t-token");
    expect(seen()).not.toContain("s3cr3t-token");            // muted echo still works
  });

  it("text falls back when the answer is blank, and confirm only accepts y/yes", async () => {
    const t = fakeTty();
    const withFallback = ttyPrompter(t).text("device id", "yoga-novo");
    await new Promise((r) => setImmediate(r));
    expect(t.seen()).toContain("device id [yoga-novo]");
    t.input.write("\n");
    expect(await withFallback).toBe("yoga-novo");

    for (const [typed, expected] of [["y", true], ["YES", true], ["n", false], ["", false], ["sure", false]] as const) {
      const c = fakeTty();
      const answered = ttyPrompter(c).confirm("Apply this plan?");
      await new Promise((r) => setImmediate(r));
      c.input.write(`${typed}\n`);
      expect(await answered, `confirm(${JSON.stringify(typed)})`).toBe(expected);
    }
  });
});
