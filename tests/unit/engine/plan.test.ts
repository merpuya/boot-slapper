import { describe, expect, it } from "vitest";
import type { Artifact } from "../../../src/engine/artifact.ts";
import { claudeConfig } from "../../../src/artifacts/claude-config.ts";
import { desktopInference } from "../../../src/artifacts/desktop-inference.ts";
import { desktopMcp } from "../../../src/artifacts/desktop-mcp.ts";
import { secrets } from "../../../src/artifacts/secrets.ts";
import { prereqs } from "../../../src/artifacts/prereqs.ts";
import { desktopSkills } from "../../../src/artifacts/desktop-skills.ts";
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
  it("requiresFor drops an option-conditional dependency, so a desktop-only profile does not pull claude-config in (Q7)", () => {
    const condSkills: Artifact = { ...stub("desktop-skills", ["desktop"], ["claude-config", "desktop-inference"]), requiresFor: (o) => (o.fromClaudeConfig === false ? ["desktop-inference"] : ["claude-config", "desktop-inference"]) };
    const inf = stub("desktop-inference", ["desktop"]);
    const p = (opts: Record<string, unknown>): Profile => ({ ...profile(["desktop"], [code, inf, condSkills]), options: { "desktop-skills": opts } });
    expect(selectArtifacts(p({ fromClaudeConfig: false })).map((a) => a.id)).toEqual(["desktop-inference", "desktop-skills"]);
    expect(selectArtifacts(p({})).map((a) => a.id)).toEqual(["claude-config", "desktop-inference", "desktop-skills"]);
  });
  it("the real desktop-skills artifact: claude-config by default, not when fromClaudeConfig is false", () => {
    expect(desktopSkills.requiresFor!({})).toEqual(["claude-config", "desktop-inference"]);
    expect(desktopSkills.requiresFor!({ skills: ["x"] })).toContain("claude-config");
    expect(desktopSkills.requiresFor!({ fromClaudeConfig: false })).toEqual(["desktop-inference"]);
  });
  it("the real desktop-mcp artifact: claude-config by default, not when the profile supplies servers", () => {
    expect(desktopMcp.requiresFor!({})).toEqual(["desktop-inference", "claude-config"]);
    expect(desktopMcp.requiresFor!({ tokens: {} })).toContain("claude-config");
    expect(desktopMcp.requiresFor!({ servers: { x: { url: "https://x" } } })).toEqual(["desktop-inference"]);
  });
  it("a faculty-shaped profile (real desktop-inference/mcp/skills, servers + fromClaudeConfig:false) selects no claude-config; the owner shape still does", () => {
    const faculty: Profile = { ...profile(["desktop"], [prereqs, secrets, claudeConfig, desktopInference, desktopMcp, desktopSkills]), options: { "desktop-mcp": { servers: { x: { url: "https://x" } }, tokens: {} }, "desktop-skills": { skills: [], fromClaudeConfig: false } } };
    expect(selectArtifacts(faculty).map((a) => a.id)).toEqual(["prereqs", "secrets", "desktop-inference", "desktop-mcp", "desktop-skills"]);
    const owner: Profile = { ...profile(["desktop"], [prereqs, secrets, claudeConfig, desktopInference, desktopMcp, desktopSkills]), options: { "desktop-mcp": { tokens: {} }, "desktop-skills": { skills: [] } } };
    expect(selectArtifacts(owner).map((a) => a.id)).toContain("claude-config");
  });
  it("still throws on an unknown requires id", () => {
    expect(() => selectArtifacts(profile(["desktop"], [stub("x", ["desktop"], ["ghost"])]))).toThrow(/unknown artifact "ghost"/);
  });
});
