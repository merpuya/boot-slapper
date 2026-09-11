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
    expect(s).toContain('exec security find-generic-password -w -s cornell-ai-gateway -a "$USER"');
    expect(s).not.toMatch(/echo|printf/);
  });
  it("linux credential helper reads the FileStore file", () => {
    expect(renderCredentialHelper("linux", "cornell-ai-gateway")).toContain('exec cat "$HOME/.config/boot-slapper/secrets/cornell-ai-gateway"');
  });
  it("win32 credential helper reads PasswordVault and writes the value without a newline", () => {
    const s = renderCredentialHelper("win32", "cornell-ai-gateway");
    expect(s).toContain("$c = $v.Retrieve('cornell-ai-gateway', $env:USERNAME)");
    expect(s).toContain("[Console]::Out.Write($c.Password)");
    expect(s).toContain("$ErrorActionPreference = 'Stop'");
  });
  it("headers helpers print one flat JSON object", () => {
    const sh = renderHeadersHelper("darwin", "mecp-device-token", "Authorization", "Bearer ");
    expect(sh).toContain('t=$(security find-generic-password -w -s mecp-device-token -a "$USER") || exit 1');
    expect(sh).toContain(`printf '{"%s":"%s%s"}\\n' 'Authorization' 'Bearer ' "$t"`);
    const ps = renderHeadersHelper("win32", "mecp-device-token", "Authorization", "Bearer ");
    expect(ps).toContain("$c = $v.Retrieve('mecp-device-token', $env:USERNAME)");
    expect(ps).toContain(`[Console]::Out.Write('{"Authorization":"Bearer ' + $c.Password + '"}')`);
  });
});
