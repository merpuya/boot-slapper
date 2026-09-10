import { describe, expect, it } from "vitest";
import { resolveOrder, type Artifact } from "../../../src/engine/artifact.ts";

const stub = (id: string, requires: string[] = []): Artifact => ({
  id, requires, surfaces: ["code"], portability: "portable",
  detect: async () => ({ kind: "present" }),
  plan: () => [],
  apply: async () => {},
  verify: async () => [],
});

describe("resolveOrder", () => {
  it("orders by dependencies, keeping declaration order among peers", () => {
    const order = resolveOrder([stub("c", ["a", "b"]), stub("a"), stub("b", ["a"])]).map((a) => a.id);
    expect(order).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    expect(() => resolveOrder([stub("a", ["b"]), stub("b", ["a"])])).toThrow(/cycle/);
  });
  it("throws on an unknown requirement", () => {
    expect(() => resolveOrder([stub("a", ["ghost"])])).toThrow(/unknown artifact "ghost"/);
  });
  it("throws on a duplicate artifact id", () => {
    expect(() => resolveOrder([stub("a"), stub("b"), stub("a")])).toThrow(/duplicate artifact id "a"/);
  });
});
