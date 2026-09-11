import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { selectArtifacts } from "../../../src/engine/plan.ts";
import type { Profile } from "../../../src/engine/profile.ts";

const stub = (id: string, surfaces: Artifact["surfaces"], requires: string[] = []): Artifact =>
  ({ id, surfaces, requires, portability: "portable", detect: async () => ({ kind: "present" }), plan: () => [], apply: async () => {}, verify: async () => [] });
const profile = (surfaces: Profile["surfaces"], artifacts: Artifact[]): Profile => ({ name: "t", provider: "gateway", surfaces, artifacts, options: {} });

describe("selectArtifacts", () => {
  const code = stub("claude-config", ["code"]);
  const both = stub("secrets", ["code", "desktop"]);
  const desk = stub("desktop-skills", ["desktop"], ["claude-config"]);
  const deskOnly = stub("hosted-connectors", ["desktop"]);
  it("pulls an off-surface dependency in, before its dependent", () => {
    // Kahn with declaration order among peers: the three root artifacts in the order they were declared, then the dependent.
    expect(selectArtifacts(profile(["desktop"], [code, both, desk, deskOnly])).map((a) => a.id)).toEqual(["claude-config", "secrets", "hosted-connectors", "desktop-skills"]);
  });
  it("leaves unrelated off-surface artifacts out", () => {
    expect(selectArtifacts(profile(["code"], [code, both, desk, deskOnly])).map((a) => a.id)).toEqual(["claude-config", "secrets"]);
  });
  it("--only/--skip filter after the pull-in, so a skipped dependency is simply absent from the plan", () => {
    expect(selectArtifacts(profile(["desktop"], [code, desk]), { skip: ["claude-config"] }).map((a) => a.id)).toEqual(["desktop-skills"]);
    expect(selectArtifacts(profile(["desktop"], [code, desk]), { only: ["desktop-skills"] }).map((a) => a.id)).toEqual(["desktop-skills"]);
  });
  it("still throws on an unknown requires id", () => {
    expect(() => selectArtifacts(profile(["desktop"], [stub("x", ["desktop"], ["ghost"])]))).toThrow(/unknown artifact "ghost"/);
  });
});
