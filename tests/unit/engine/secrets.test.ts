import { describe, expect, it } from "vitest";
import { FakeIo } from "../../../src/engine/io.ts";
import { KeychainStore } from "../../../src/engine/secrets/keychain.ts";
import { PasswordVaultStore } from "../../../src/engine/secrets/passwordvault.ts";
import { FileStore } from "../../../src/engine/secrets/filestore.ts";
import { MECP_API_KEY_FILE, defaultAccount, selectStore } from "../../../src/engine/secrets/store.ts";
import { resolveEnv, probeEnv } from "../../../src/engine/env.ts";

const ref = { service: "cornell-ai-gateway" as const, account: "aca34" };

describe("KeychainStore", () => {
  it("get reads the value from stdout via argv (no secret in argv)", async () => {
    const io = new FakeIo();
    io.on((c, a) => c === "security" && a[0] === "find-generic-password", () => ({ code: 0, stdout: "s3cret\n", stderr: "" }));
    const v = await new KeychainStore(io).get(ref);
    expect(v).toBe("s3cret");
    expect(io.calls[0].args).toEqual(["find-generic-password", "-w", "-s", "cornell-ai-gateway", "-a", "aca34"]);
  });
  it("get returns null when the item is missing (exit 44)", async () => {
    const io = new FakeIo();
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "could not be found" }));
    expect(await new KeychainStore(io).get(ref)).toBeNull();
  });
  it("set passes the value on stdin through `security -i`, never argv", async () => {
    const io = new FakeIo();
    io.on((c) => c === "security", () => ({ code: 0, stdout: "", stderr: "" }));
    await new KeychainStore(io).set(ref, "it's a secret");
    const call = io.calls[0];
    expect(call.args).toEqual(["-i"]);
    expect(call.opts.stdin).toBe(`add-generic-password -U -s 'cornell-ai-gateway' -a 'aca34' -w 'it'\\''s a secret'\n`);
    expect(JSON.stringify(call.args)).not.toContain("secret");
  });
  it("describe names the Keychain item", () => {
    expect(new KeychainStore(new FakeIo()).describe(ref)).toBe("login Keychain item service=cornell-ai-gateway account=aca34");
  });
});

describe("PasswordVaultStore", () => {
  it("get runs a PowerShell script from stdin and reads stdout", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "s3cret\r\n", stderr: "" }));
    expect(await new PasswordVaultStore(io).get(ref)).toBe("s3cret");
    const call = io.calls[0];
    expect(call.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", "-"]);
    expect(call.opts.stdin).toContain("$v.Retrieve('cornell-ai-gateway','aca34')");
  });
  it("get returns null on exit 44", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 44, stdout: "", stderr: "" }));
    expect(await new PasswordVaultStore(io).get(ref)).toBeNull();
  });
  it("set embeds the value in the stdin script with single quotes doubled", async () => {
    const io = new FakeIo({ platform: "win32" });
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "", stderr: "" }));
    await new PasswordVaultStore(io).set(ref, "it's a secret");
    const call = io.calls[0];
    expect(call.opts.stdin).toContain("PasswordCredential('cornell-ai-gateway','aca34','it''s a secret')");
    expect(JSON.stringify(call.args)).not.toContain("secret");
  });
});

describe("FileStore", () => {
  it("writes <dir>/<service> mode 600 and reads it back trimmed", async () => {
    const io = new FakeIo();
    const s = new FileStore(io, "/h/.config/boot-slapper/secrets");
    expect(await s.get(ref)).toBeNull();
    await s.set(ref, "v");
    expect(io.files.get("/h/.config/boot-slapper/secrets/cornell-ai-gateway")).toBe("v\n");
    expect(io.modes.get("/h/.config/boot-slapper/secrets/cornell-ai-gateway")).toBe(0o600);
    expect(await s.get(ref)).toBe("v");
  });
});

describe("selectStore", () => {
  it("routes mecp-api-key to ~/.config/mecp/api_key on every OS and the rest to the OS store", async () => {
    const io = new FakeIo({ platform: "darwin", files: { "/h/.config/mecp/api_key": "k\n" } });
    const env = resolveEnv(await probeEnv(io), "gateway", "code");
    const store = selectStore(env, io);
    expect(await store.get({ service: "mecp-api-key", account: "x" })).toBe("k");
    expect(store.describe({ service: "mecp-api-key", account: "x" })).toBe(`file ${MECP_API_KEY_FILE("/h", "darwin")} (mode 600)`);
    expect(store.describe(ref)).toMatch(/Keychain/);
  });
  it("defaultAccount prefers USER, then USERNAME", () => {
    expect(defaultAccount(new FakeIo({ env: { USER: "aca34" } }))).toBe("aca34");
    expect(defaultAccount(new FakeIo({ env: { USERNAME: "aca34w" } }))).toBe("aca34w");
    expect(defaultAccount(new FakeIo())).toBe("user");
  });
});
