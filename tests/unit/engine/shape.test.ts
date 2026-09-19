import { describe, expect, it } from "vitest";
import { checkShape } from "../../../src/engine/secrets/shape.ts";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJraW5kIjoiZGV2aWNlIn0.c2lnbmF0dXJl";
const MASTER_LIKE = "sk-not-a-jwt-39-chars-long-abcdefghij123";

describe("checkShape", () => {
  it("passes a JWT for both MeCP services", () => {
    expect(checkShape("mecp-api-key", JWT)).toEqual({ ok: true });
    expect(checkShape("mecp-device-token", JWT)).toEqual({ ok: true });
  });

  it("flags a non-JWT and names the remedy without echoing the value", () => {
    const v = checkShape("mecp-api-key", MASTER_LIKE);
    expect(v?.ok).toBe(false);
    expect(v && !v.ok && v.reason).toMatch(/master MeCP API_KEY/);
    expect(v && !v.ok && v.reason).toMatch(/mint-device-token/);
    expect(JSON.stringify(v)).not.toContain(MASTER_LIKE);
  });

  // The distinction that keeps this from becoming its own false green: a service with no documented
  // shape must return null, so a caller can say "present" without implying "and it looks right".
  it("returns null — not ok — for services with no documented shape", () => {
    expect(checkShape("cornell-ai-gateway", MASTER_LIKE)).toBeNull();
    expect(checkShape("mct-sync-token", "anything")).toBeNull();
  });

  it("rejects near-misses rather than accepting anything with dots", () => {
    expect(checkShape("mecp-api-key", "a.b")?.ok).toBe(false); // two segments
    expect(checkShape("mecp-api-key", "a.b.c.d")?.ok).toBe(false); // four
    expect(checkShape("mecp-api-key", "a..c")?.ok).toBe(false); // empty middle
    expect(checkShape("mecp-api-key", "a.b c.d")?.ok).toBe(false); // whitespace inside
  });
});
