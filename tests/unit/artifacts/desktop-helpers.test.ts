import { describe, expect, it } from "vitest";
import { HELPER_MODE, helperPath, renderCredentialHelper, renderHeadersHelper } from "../../../src/artifacts/templates/desktop-helpers.ts";

describe("desktop helper templates", () => {
  it("paths and mode", () => {
    expect(helperPath("darwin", "/h", "desktop-inference-credential")).toBe("/h/.config/boot-slapper/desktop-inference-credential.sh");
    expect(helperPath("win32", "C:\\Users\\t", "desktop-inference-credential")).toBe("C:\\Users\\t\\.config\\boot-slapper\\desktop-inference-credential.ps1");
    expect(HELPER_MODE).toBe(0o700);
  });
  it("darwin credential helper reads the login Keychain and prints only the value", () => {
    const s = renderCredentialHelper("darwin", "cornell-ai-gateway");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain('exec security find-generic-password -w -s cornell-ai-gateway -a "${USER:-$USERNAME}"');
    expect(s).not.toMatch(/echo|printf/);
  });
  it("linux credential helper reads the FileStore file", () => {
    expect(renderCredentialHelper("linux", "cornell-ai-gateway")).toContain('exec cat "$HOME/.config/boot-slapper/secrets/cornell-ai-gateway"');
  });
  it("win32 credential helper reads PasswordVault and writes the value without a newline", () => {
    const s = renderCredentialHelper("win32", "cornell-ai-gateway");
    expect(s).toContain("$acct = if ($env:USER) { $env:USER } else { $env:USERNAME }");
    expect(s).toContain("$c = $v.Retrieve('cornell-ai-gateway', $acct)");
    expect(s).toContain("[Console]::Out.Write($c.Password)");
    expect(s).toContain("$ErrorActionPreference = 'Stop'");
  });
  it("headers helpers print one flat JSON object", () => {
    const sh = renderHeadersHelper("darwin", "mecp-device-token", "Authorization", "Bearer ");
    expect(sh).toContain('t=$(security find-generic-password -w -s mecp-device-token -a "${USER:-$USERNAME}") || exit 1');
    expect(sh).toContain(`printf '{"%s":"%s%s"}\\n' 'Authorization' 'Bearer ' "$t"`);
    const ps = renderHeadersHelper("win32", "mecp-device-token", "Authorization", "Bearer ");
    expect(ps).toContain("$acct = if ($env:USER) { $env:USER } else { $env:USERNAME }");
    expect(ps).toContain("$c = $v.Retrieve('mecp-device-token', $acct)");
    expect(ps).toContain(`[Console]::Out.Write('{"Authorization":"Bearer ' + $c.Password + '"}')`);
  });

  // --- fix round 1: input validation (Finding 1) ---
  it("rejects an adversarial header for both darwin and win32", () => {
    const badHeader = "X'; rm -rf /";
    expect(() => renderHeadersHelper("darwin", "mecp-device-token", badHeader, "Bearer ")).toThrow(/header/);
    expect(() => renderHeadersHelper("win32", "mecp-device-token", badHeader, "Bearer ")).toThrow(/header/);
  });
  it("rejects an adversarial prefix for both darwin and win32", () => {
    const badPrefix = "Bearer '$(id)";
    expect(() => renderHeadersHelper("darwin", "mecp-device-token", "Authorization", badPrefix)).toThrow(/prefix/);
    expect(() => renderHeadersHelper("win32", "mecp-device-token", "Authorization", badPrefix)).toThrow(/prefix/);
  });
  it("rejects an unsafe service/account", () => {
    const badService = "cornell-ai-gateway'; rm -rf /" as unknown as "cornell-ai-gateway";
    expect(() => renderCredentialHelper("darwin", badService)).toThrow();
    expect(() => renderCredentialHelper("win32", badService)).toThrow();
    expect(() => renderCredentialHelper("darwin", "cornell-ai-gateway", "aca34'; rm -rf /")).toThrow();
    expect(() => renderHeadersHelper("win32", "mecp-device-token", "Authorization", "Bearer ", "aca34'; rm -rf /")).toThrow();
  });

  // --- fix round 1: account baked in / runtime fallback (Finding 2) ---
  it("bakes an explicit account into the darwin script as a single-quoted literal", () => {
    const s = renderCredentialHelper("darwin", "cornell-ai-gateway", "aca34");
    expect(s).toContain("-a 'aca34'");
  });
  it("bakes an explicit account into the win32 script", () => {
    const s = renderCredentialHelper("win32", "cornell-ai-gateway", "aca34");
    expect(s).toContain("Retrieve('cornell-ai-gateway', 'aca34')");
    expect(s).not.toContain("$env:USER");
  });
  it("falls back to USER-then-USERNAME at runtime when account is omitted", () => {
    const sh = renderCredentialHelper("darwin", "cornell-ai-gateway");
    expect(sh).toContain('${USER:-$USERNAME}');
    const ps = renderCredentialHelper("win32", "cornell-ai-gateway");
    expect(ps).toContain("$env:USER");
    expect(ps).toContain("$env:USERNAME");
  });
});
