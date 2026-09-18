import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";
import { assertSafeRef } from "./ref.ts";

const ps = (s: string) => s.replace(/'/g, "''");
const PRELUDE = `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]\n$v = New-Object Windows.Security.Credentials.PasswordVault\n`;

/** Windows Credential Manager via PasswordVault (user-scoped, DPAPI). Script goes to PowerShell on stdin; argv carries no names or values. */
export class PasswordVaultStore implements SecretStore {
  constructor(private io: Io) {}
  private run(script: string) {
    return this.io.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdin: PRELUDE + script });
  }
  async get(ref: SecretRef): Promise<string | null> {
    assertSafeRef(ref);
    const r = await this.run(
      `try { $c = $v.Retrieve('${ps(ref.service)}','${ps(ref.account)}'); $c.RetrievePassword(); Write-Output $c.Password } catch { exit 44 }\n`,
    );
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  /**
   * `Add` must be the last thing the script does — no `exit` may follow it inside a `try` block.
   *
   * PasswordVault commits asynchronously. Reached through a `try`, an `exit` immediately after `Add` tears the
   * process down before the commit lands: PowerShell exits 0, `Add` reports nothing, and the credential is simply
   * gone. Verified 2026-09-18 on yogaNovo — 5/5 deterministic losses with the old script, while the same `Add`
   * with the `exit` outside the `try` (or with no `exit` at all) persisted every time. Nothing surfaced the
   * failure: `set` returned success and `get` then said "missing", which is what sent the owner looking for a
   * mistyped command, and what let `desktop-inference` write a credential helper against an empty store.
   *
   * So: let the script fall off its own end. With `$ErrorActionPreference = 'Stop'` an `Add` failure is a
   * terminating error, so PowerShell exits non-zero on its own — the hand-rolled `exit 45` bought nothing and cost
   * the commit. `Remove` of a stale entry stays best-effort in its own `try`: it has nothing after it to tear down,
   * and its failure is uninteresting — only `Add`'s is.
   *
   * stderr is deliberately not quoted in the error: a PowerShell error record echoes the offending source line,
   * which is the `PasswordCredential(...)` call carrying the plaintext.
   */
  async set(ref: SecretRef, value: string): Promise<void> {
    assertSafeRef(ref);
    const r = await this.run(
      `$ErrorActionPreference = 'Stop'\n` +
      `try { $v.Remove($v.Retrieve('${ps(ref.service)}','${ps(ref.account)}')) } catch {}\n` +
      `$v.Add((New-Object Windows.Security.Credentials.PasswordCredential('${ps(ref.service)}','${ps(ref.account)}','${ps(value)}')))\n`,
    );
    if (r.code !== 0) throw new Error(`PasswordVault add failed (exit ${r.code})`);
    // Read it back in a fresh process: the bug this replaces was invisible precisely because `set` trusted its own
    // exit code. A store that cannot confirm the write must say so rather than report success.
    if ((await this.get(ref)) === null) throw new Error(`PasswordVault reported success but ${this.describe(ref)} is not readable afterwards — the credential did not commit`);
  }
  describe(ref: SecretRef): string {
    return `Windows Credential Manager (PasswordVault) resource=${ref.service} user=${ref.account}`;
  }
}
