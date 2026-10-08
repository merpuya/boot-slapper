import { managedSources, APP_BEHAVIOR_KEYS } from "./desktop.ts";
import type { Os } from "./env.ts";
import type { Io } from "./io.ts";

/** Print-ready support contact. Taken from the faculty KB (spec Q9 default: print the KB address). */
export const SUPPORT_CONTACT = "itrequests@business.cornell.edu";
export const MANAGED_REFUSAL = "This computer's Claude settings are managed by your organisation. This tool does not change managed settings.";

export type GateVerdict = "clean" | "managed" | "unknown";
export interface GateResult {
  verdict: GateVerdict;
  /** User-facing refusal text; null when clean. */
  message: string | null;
  /** Which source and keys decided it; null when clean. Never a value. */
  detail: string | null;
}

/**
 * Spec section 5. Read-only: runs the same managed-source probes `desktop-inference` uses. Any key outside the app-behaviour set means
 * managed; a source that exists but cannot be read means managed-unknown, which refuses too (absence of evidence is not "clean").
 * A readable owning source wins over an unreadable one, since it is the stronger fact.
 */
export async function managedGate(io: Io, os: Os): Promise<GateResult> {
  const sources = await managedSources(io, os);
  for (const s of sources) {
    const owning = s.readable ? s.keys.filter((k) => !APP_BEHAVIOR_KEYS.has(k)) : [];
    if (owning.length) return { verdict: "managed", message: `${MANAGED_REFUSAL} Ask IT: ${SUPPORT_CONTACT}`, detail: `${s.source} sets ${owning.join(", ")}` };
  }
  const bad = sources.find((s) => !s.readable);
  if (bad) return { verdict: "unknown", message: `Could not verify whether this computer's Claude settings are managed by your organisation, so this tool stops rather than guess. Ask IT: ${SUPPORT_CONTACT}`, detail: `could not read ${bad.source}` };
  return { verdict: "clean", message: null, detail: null };
}
