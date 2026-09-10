import { describe, expect, it } from "vitest";
import { secrets } from "../../../src/artifacts/secrets.ts";
import { makeCtx } from "../helpers.ts";

const opts = { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key"] };

describe("secrets", () => {
  it("is absent with one interactive step per missing secret, naming the location not the value", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.config/mecp/api_key": "k\n" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    const s = await secrets.detect(ctx);
    expect(s).toEqual({ kind: "absent", details: [
      "cornell-ai-gateway missing — login Keychain item service=cornell-ai-gateway account=aca34",
      "mecp-device-token missing — login Keychain item service=mecp-device-token account=aca34",
    ] });
    const steps = secrets.plan(ctx, s);
    expect(steps).toEqual([
      { id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } },
      { id: "secrets.mecp-device-token", title: "Paste the MeCP device token (mint it on a box with admin access: mecp/scripts/mint-device-token.ts --scope write)", interactive: true, secret: { service: "mecp-device-token", account: "aca34" } },
    ]);
  });

  it("apply prompts, stores via stdin, and never puts the value in events or argv", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { USER: "aca34" }, interactive: true, answers: { "Paste the Cornell AI gateway key": "sk-live-XYZ" } });
    io.on((c) => c === "security", () => ({ code: 0, stdout: "", stderr: "" }));
    await secrets.apply(ctx, [{ id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } }]);
    const set = io.calls.find((c) => c.cmd === "security" && c.args[0] === "-i");
    expect(set?.opts.stdin).toContain(Buffer.from("sk-live-XYZ", "utf8").toString("hex"));
    expect(JSON.stringify(io.calls.map((c) => c.args))).not.toContain("sk-live-XYZ");
    expect(JSON.stringify(events)).not.toContain("sk-live-XYZ");
  });

  it("apply with a blank answer skips with a warning instead of writing", async () => {
    const { ctx, io, events } = await makeCtx({ opts, env: { USER: "aca34" }, interactive: true, answers: {} });
    await secrets.apply(ctx, [{ id: "secrets.cornell-ai-gateway", title: "Paste the Cornell AI gateway key", interactive: true, secret: { service: "cornell-ai-gateway", account: "aca34" } }]);
    expect(io.calls).toHaveLength(0);
    expect(events).toContainEqual({ type: "note", level: "warn", message: "secrets: cornell-ai-gateway skipped (blank)" });
  });

  it("verify: gateway missing is an error, the others warn, present ones are ok", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.config/mecp/api_key": "k\n" } });
    io.on((c, a) => c === "security" && a.includes("mecp-device-token"), () => ({ code: 0, stdout: "tok\n", stderr: "" }));
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    expect((await secrets.verify(ctx)).map((c) => [c.id, c.status])).toEqual([
      ["cornell-ai-gateway", "error"], ["mecp-device-token", "ok"], ["mecp-api-key", "ok"],
    ]);
  });
});
