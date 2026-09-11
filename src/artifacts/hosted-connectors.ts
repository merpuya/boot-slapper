import type { Artifact, Bundle, Check, Ctx, State } from "../engine/artifact.ts";

const ID = "hosted-connectors";
interface Opts { connectors: string[]; features: string[] }
const WORKS = "skills, plugins, hooks, remote MCP, memory, projects and scheduled tasks DO work on 3P (feature matrix, 2026-09-10)";
const lines = (ctx: Ctx) => {
  const o = ctx.opts as unknown as Opts;
  return [`claude.ai-hosted connectors are not available on a gateway box: ${(o.connectors ?? []).join(", ")}`, `not available in Claude Desktop on 3P: ${(o.features ?? []).join(", ")}`, WORKS];
};

/** Spec §4 row 12: nothing to apply; the plan and the bundle state what a gateway box does not have. */
export const hostedConnectors: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "non-transferable", requires: [],
  async detect(ctx): Promise<State> { return { kind: "absent", details: lines(ctx) }; },
  plan: () => [],
  async apply() {},
  async verify(ctx): Promise<Check[]> {
    const o = ctx.opts as unknown as Opts;
    return [
      { id: "connectors", status: "ok", message: `not on a gateway box (expected): ${(o.connectors ?? []).join(", ")}` },
      { id: "features", status: "ok", message: `not in Claude Desktop on 3P (expected): ${(o.features ?? []).join(", ")}` },
    ];
  },
  async capture(ctx): Promise<Bundle> { return { files: [], instructions: lines(ctx) }; },
};
