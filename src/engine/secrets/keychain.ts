import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** macOS login Keychain. get: value arrives on stdout (argv carries only names). set: command line on stdin via `security -i`. */
export class KeychainStore implements SecretStore {
  constructor(private io: Io) {}
  async get(ref: SecretRef): Promise<string | null> {
    const r = await this.io.exec("security", ["find-generic-password", "-w", "-s", ref.service, "-a", ref.account]);
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string): Promise<void> {
    const line = `add-generic-password -U -s ${sq(ref.service)} -a ${sq(ref.account)} -w ${sq(value)}\n`;
    const r = await this.io.exec("security", ["-i"], { stdin: line });
    if (r.code !== 0) throw new Error(`security add-generic-password failed (${r.code}): ${r.stderr.trim()}`);
  }
  describe(ref: SecretRef): string {
    return `login Keychain item service=${ref.service} account=${ref.account}`;
  }
}
