import { describe, expect, it } from "vitest";
import { gatewayLaunch, MARKER } from "../../../src/artifacts/gateway-launch.ts";
import { makeCtx } from "../helpers.ts";

const opts = { baseUrl: "https://api.ai.it.cornell.edu" };
const bundle = JSON.stringify({ mcpServers: { openbrain: { type: "http", url: "https://ob/mcp" }, mecp: { type: "http", url: "https://mecp/mcp", headers: { Authorization: "Bearer ${MECP_DEVICE_TOKEN}" } } } });

describe("gateway-launch (darwin)", () => {
  it("absent on a fresh box: writes the wrapper and appends one marker line to ~/.zshrc", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: { "/h/.claude/mcp/gateway.json": bundle, "/h/.zshrc": "export FOO=1\n" } });
    // NOTE: deviation from brief — the brief's mock returned stdout "tok\n" and asserted
    // `not.toContain("tok")`, but the mandated template statically contains the word "token"
    // (comments + the unavoidable `local gw_token mecp_token` declaration), which itself
    // contains "tok" as a substring. That assertion is unsatisfiable by any correct
    // implementation of the mandated template. detect/apply never call io.exec("security", ...)
    // (only verify() reads secrets), so this mock is inert on this codepath regardless; the test's
    // real intent — no leaked secret value — is preserved by using a value that doesn't collide
    // with the word "token".
    io.on((c) => c === "security", () => ({ code: 0, stdout: "s3cr3t-val\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    expect(s.kind).toBe("absent");
    const steps = gatewayLaunch.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["gateway-launch.wrapper", "gateway-launch.shell-rc"]);
    await gatewayLaunch.apply(ctx, steps);
    const wrapper = io.files.get("/h/.config/boot-slapper/claude-gw.zsh")!;
    expect(wrapper).toContain('ANTHROPIC_BASE_URL="https://api.ai.it.cornell.edu"');
    expect(wrapper).toContain('--mcp-config "$HOME/.claude/mcp/gateway.json"');
    expect(wrapper).not.toContain("s3cr3t-val");
    expect(io.files.get("/h/.zshrc")).toBe(`export FOO=1\n[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  ${MARKER}\n`);
    expect(await gatewayLaunch.detect(ctx)).toEqual({ kind: "present" });
    await gatewayLaunch.apply(ctx, gatewayLaunch.plan(ctx, { kind: "present" }));
    expect(io.files.get("/h/.zshrc")!.split(MARKER).length).toBe(2); // still exactly one marker line
  });

  it("a hand-edited wrapper is regenerated (we own it); the rc line is never edited", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" }, files: {
      "/h/.claude/mcp/gateway.json": bundle,
      "/h/.config/boot-slapper/claude-gw.zsh": "# stale\n",
      "/h/.zshrc": `source ~/projects/dotfiles/zsh/claude-gw.zsh\n[ -f "$HOME/.config/boot-slapper/claude-gw.zsh" ] && source "$HOME/.config/boot-slapper/claude-gw.zsh"  ${MARKER}\n`,
    } });
    io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    expect(s).toEqual({ kind: "drifted", details: ["wrapper differs from the generated version — will regenerate"] });
    expect(gatewayLaunch.plan(ctx, s).map((x) => x.id)).toEqual(["gateway-launch.wrapper"]);
    const checks = await gatewayLaunch.verify(ctx);
    expect(checks.find((c) => c.id === "legacy-wrapper")).toMatchObject({ status: "warn", message: expect.stringMatching(/dotfiles\/zsh\/claude-gw\.zsh/) });
  });

  it("verify: missing bundle or gateway secret are errors", async () => {
    const { ctx, io } = await makeCtx({ opts, env: { USER: "aca34" } });
    io.on((c) => c === "security", () => ({ code: 44, stdout: "", stderr: "" }));
    const ids = Object.fromEntries((await gatewayLaunch.verify(ctx)).map((c) => [c.id, c.status]));
    expect(ids).toMatchObject({ wrapper: "error", "shell-rc": "error", "mcp-bundle": "error", "gateway-secret": "error" });
  });
});

describe("gateway-launch (win32)", () => {
  it("writes the ps1 + cmd shim and appends to $PROFILE", async () => {
    const home = "C:\\Users\\t";
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t", PATH: `${home}\\.local\\bin;C:\\Windows` }, files: { [`${home}\\.claude\\mcp\\gateway.json`]: bundle } });
    io.on((c, a) => c === "powershell" && a.includes("$PROFILE"), () => ({ code: 0, stdout: `${home}\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1\r\n`, stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    const steps = gatewayLaunch.plan(ctx, s);
    expect(steps.map((x) => x.id)).toEqual(["gateway-launch.wrapper", "gateway-launch.cmd-shim", "gateway-launch.shell-rc"]);
    await gatewayLaunch.apply(ctx, steps);
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw.ps1`)).toContain("$env:ANTHROPIC_BASE_URL = 'https://api.ai.it.cornell.edu'");
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw.ps1`)).toContain('--mcp-config "$env:USERPROFILE\\.claude\\mcp\\gateway.json"');
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw.ps1`)).toContain("[Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process')");
    expect(io.files.get(`${home}\\.config\\boot-slapper\\claude-gw-run.ps1`)).toContain("claude-gw @args");
    expect(io.files.get(`${home}\\.local\\bin\\claude-gw.cmd`)).toMatch(/^@echo off\r\n/);
    expect(io.files.get(`${home}\\.local\\bin\\claude-gw.cmd`)).toContain('-File "%USERPROFILE%\\.config\\boot-slapper\\claude-gw-run.ps1" %*');
    expect(io.files.get(`${home}\\.local\\bin\\claude-gw.cmd`)).not.toContain("-Command");
    expect(io.files.get(`${home}\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1`)).toBe(`. "$env:USERPROFILE\\.config\\boot-slapper\\claude-gw.ps1"  ${MARKER}\n`);
    expect((await gatewayLaunch.verify(ctx)).find((c) => c.id === "path")).toMatchObject({ status: "ok" });
    expect(await gatewayLaunch.detect(ctx)).toEqual({ kind: "present" });
    expect(gatewayLaunch.plan(ctx, { kind: "present" })).toEqual([]);
  });

  it("falls back to the Windows PowerShell 5.1 profile path when $PROFILE can't be probed (matches the shell this probe execs)", async () => {
    const home = "C:\\Users\\t";
    const { ctx, io } = await makeCtx({ opts, platform: "win32", home, env: { USERNAME: "t" }, files: { [`${home}\\.claude\\mcp\\gateway.json`]: bundle } });
    io.on((c, a) => c === "powershell" && a.includes("$PROFILE"), () => ({ code: 1, stdout: "", stderr: "" }));
    io.on((c) => c === "powershell", () => ({ code: 0, stdout: "tok\r\n", stderr: "" }));
    const s = await gatewayLaunch.detect(ctx);
    const steps = gatewayLaunch.plan(ctx, s);
    await gatewayLaunch.apply(ctx, steps);
    expect(io.files.get(`${home}\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1`)).toBe(`. "$env:USERPROFILE\\.config\\boot-slapper\\claude-gw.ps1"  ${MARKER}\n`);
  });
});
