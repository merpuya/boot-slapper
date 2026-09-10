import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

const ps = (s: string) => s.replace(/'/g, "''");
const PRELUDE = `[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]\n$v = New-Object Windows.Security.Credentials.PasswordVault\n`;

/** Windows Credential Manager via PasswordVault (user-scoped, DPAPI). Script goes to PowerShell on stdin; argv carries no names or values. */
export class PasswordVaultStore implements SecretStore {
  constructor(private io: Io) {}
  private run(script: string) {
    return this.io.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], { stdin: PRELUDE + script });
  }
  async get(ref: SecretRef): Promise<string | null> {
    const r = await this.run(
      `try { $c = $v.Retrieve('${ps(ref.service)}','${ps(ref.account)}'); $c.RetrievePassword(); Write-Output $c.Password } catch { exit 44 }\n`,
    );
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string): Promise<void> {
    const r = await this.run(
      `try { $old = $v.Retrieve('${ps(ref.service)}','${ps(ref.account)}'); $v.Remove($old) } catch {}\n` +
      `$v.Add((New-Object Windows.Security.Credentials.PasswordCredential('${ps(ref.service)}','${ps(ref.account)}','${ps(value)}')))\n`,
    );
    if (r.code !== 0) throw new Error(`PasswordVault add failed (${r.code}): ${r.stderr.trim()}`);
  }
  describe(ref: SecretRef): string {
    return `Windows Credential Manager (PasswordVault) resource=${ref.service} user=${ref.account}`;
  }
}
