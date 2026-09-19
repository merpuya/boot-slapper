import type { SecretService } from "./store.ts";

/**
 * Shape expectations for stored secrets.
 *
 * Declared ONLY where the store cannot tell two different credentials apart, because that is the
 * only place a shape check buys anything. `mecp-api-key` and `mecp-device-token` are both bearer
 * strings for the same server, and `mecp/scripts/mint-device-token.ts` installs a per-device JWT to
 * the very path (`~/.config/mecp/api_key`) that the master `API_KEY` also gets hand-installed to.
 * Both authenticate, so the wrong one works and looks like a correct install — one sat on `yogaNovo`
 * from 2026-08-06 to 2026-09-18 and nothing in the pipeline noticed. See MeCP
 * `project:dotclaude/mecp-key-file-shape-check`; the hook-side twin of this check is dotclaude
 * `7647d17`.
 *
 * Deliberately NOT declared for `cornell-ai-gateway` or `mct-sync-token`. A gateway key observed
 * once with an `sk-` prefix is not a documented invariant, and a shape rule invented from one sample
 * produces false warnings — which is how a warning channel stops being read.
 */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type ShapeVerdict = { ok: true } | { ok: false; reason: string };

const MECP_JWT = (v: string): ShapeVerdict =>
  JWT.test(v)
    ? { ok: true }
    : {
        ok: false,
        reason:
          "not JWT-shaped — probably the master MeCP API_KEY, which individual devices should never hold. " +
          "Mint a scoped device token on a box that has the master (mecp/scripts/mint-device-token.ts --device <box> --scope write) and store that instead",
      };

const EXPECT: Partial<Record<SecretService, (value: string) => ShapeVerdict>> = {
  "mecp-api-key": MECP_JWT,
  "mecp-device-token": MECP_JWT,
};

/**
 * `null` means "no documented shape for this service" — silence, not a pass.
 *
 * The distinction matters: a caller that got `{ ok: true }` may say the value looks right, and a
 * caller that got `null` may only say it is present. Collapsing the two would be the same class of
 * false green this check exists to prevent.
 *
 * Never returns, logs or embeds the value; the verdict carries a reason string and nothing else.
 */
export function checkShape(service: SecretService, value: string): ShapeVerdict | null {
  return EXPECT[service]?.(value) ?? null;
}
