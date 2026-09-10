import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";
import { assertSafeRef } from "./ref.ts";

/** macOS login Keychain. get: value arrives on stdout (argv carries only names). set: value hex-encoded via `-X` on stdin through `security -i` (sidesteps `security -i`'s stdin quoting, which does not honor the `'\''` embedded-quote idiom). */
export class KeychainStore implements SecretStore {
  constructor(private io: Io) {}
  async get(ref: SecretRef): Promise<string | null> {
    assertSafeRef(ref);
    const r = await this.io.exec("security", ["find-generic-password", "-w", "-s", ref.service, "-a", ref.account]);
    if (r.code !== 0) return null;
    const v = r.stdout.replace(/\r?\n$/, "");
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string): Promise<void> {
    assertSafeRef(ref);
    const line = `add-generic-password -U -s ${ref.service} -a ${ref.account} -X ${Buffer.from(value, "utf8").toString("hex")}\n`;
    const r = await this.io.exec("security", ["-i"], { stdin: line });
    if (r.code !== 0) throw new Error(`security add-generic-password failed (${r.code}): ${r.stderr.trim()}`);
  }
  describe(ref: SecretRef): string {
    return `login Keychain item service=${ref.service} account=${ref.account}`;
  }
}
