import type { SecretRef } from "./store.ts";

const SAFE_NAME = /^[A-Za-z0-9._@-]+$/;

/** Guards against shell/PowerShell-significant characters in service/account before they're interpolated into a command line or script. */
export function assertSafeRef(ref: SecretRef): void {
  for (const [k, v] of [["service", ref.service], ["account", ref.account]] as const) {
    if (!SAFE_NAME.test(v)) throw new Error(`secret ${k} contains characters outside [A-Za-z0-9._@-]: ${JSON.stringify(v)}`);
  }
}
