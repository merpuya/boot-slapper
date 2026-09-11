import { describe, expect, it } from "vitest";
import { hostedConnectors } from "../../../src/artifacts/hosted-connectors.ts";
import { makeCtx } from "../helpers.ts";

const opts = { connectors: ["Gmail", "Todoist"], features: ["Claude in Chrome"] };

describe("hosted-connectors", () => {
  it("is instructions only: absent with the list, no steps, ok checks, capture instructions; never execs or writes", async () => {
    const { ctx, io } = await makeCtx({ opts });
    const s = await hostedConnectors.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: ["claude.ai-hosted connectors are not available on a gateway box: Gmail, Todoist", "not available in Claude Desktop on 3P: Claude in Chrome", "skills, plugins, hooks, remote MCP, memory, projects and scheduled tasks DO work on 3P (feature matrix, 2026-09-10)"] });
    expect(hostedConnectors.plan(ctx, s)).toEqual([]);
    await hostedConnectors.apply(ctx, []);
    expect(await hostedConnectors.verify(ctx)).toEqual([
      { id: "connectors", status: "ok", message: "not on a gateway box (expected): Gmail, Todoist" },
      { id: "features", status: "ok", message: "not in Claude Desktop on 3P (expected): Claude in Chrome" },
    ]);
    expect((await hostedConnectors.capture!(ctx)).files).toEqual([]);
    expect((await hostedConnectors.capture!(ctx)).instructions).toEqual(s.details);
    expect(io.calls).toEqual([]); expect(io.writes).toEqual([]);
  });
});
