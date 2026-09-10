import type { Artifact, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { defaultAccount, type SecretRef, type SecretService } from "../engine/secrets/store.ts";

export const SECRET_LABELS: Record<SecretService, string> = {
  "cornell-ai-gateway": "Paste the Cornell AI gateway key",
  "mecp-device-token": "Paste the MeCP device token (mint it on a box with admin access: mecp/scripts/mint-device-token.ts --scope write)",
  "mecp-api-key": "Paste the MeCP API key used by the SessionStart context hook",
  "mct-sync-token": "Paste the mct sync token (from `mct devices add` on an admin box)",
};
export const SECRET_SEVERITY: Record<SecretService, "error" | "warn"> = {
  "cornell-ai-gateway": "error", "mecp-device-token": "warn", "mecp-api-key": "warn", "mct-sync-token": "warn",
};

// detect formats details with this separator and plan parses them back — State.details is the only channel between the two (engine/artifact.ts), so the separator must be shared.
export const MISSING_SEP = " missing — ";

const ID = "secrets";
const refs = (ctx: Ctx): SecretRef[] => {
  const services = ((ctx.opts as { services?: SecretService[] }).services ?? []);
  const account = defaultAccount(ctx.io);
  return services.map((service) => ({ service, account }));
};

async function missing(ctx: Ctx): Promise<SecretRef[]> {
  const out: SecretRef[] = [];
  for (const ref of refs(ctx)) if ((await ctx.secrets.get(ref)) === null) out.push(ref);
  return out;
}

export const secrets: Artifact = {
  id: ID, surfaces: ["code", "desktop"], portability: "device-bound", requires: ["prereqs"],

  async detect(ctx): Promise<State> {
    const m = await missing(ctx);
    return m.length ? { kind: "absent", details: m.map((r) => `${r.service}${MISSING_SEP}${ctx.secrets.describe(r)}`) } : { kind: "present" };
  },

  plan(ctx, state): Step[] {
    if (state.kind !== "absent") return [];
    const account = defaultAccount(ctx.io);
    return (state.details ?? []).map((d) => d.split(MISSING_SEP)[0] as SecretService).map((service) => ({
      id: `${ID}.${service}`, title: SECRET_LABELS[service], interactive: true, secret: { service, account },
    }));
  },

  async apply(ctx, steps) {
    for (const s of steps) {
      if (!s.secret) throw new Error(`step ${s.id} carries no SecretRef`);
      const value = (await ctx.prompt.secret(s.title)).trim();
      if (!value) { ctx.emit({ type: "note", level: "warn", message: `secrets: ${s.secret.service} skipped (blank)` }); continue; }
      await ctx.secrets.set(s.secret, value);
      ctx.emit({ type: "note", level: "info", message: `secrets: stored ${s.secret.service} → ${ctx.secrets.describe(s.secret)}` });
    }
  },

  async verify(ctx): Promise<Check[]> {
    const out: Check[] = [];
    for (const ref of refs(ctx)) {
      const present = (await ctx.secrets.get(ref)) !== null;
      out.push(present
        ? { id: ref.service, status: "ok", message: `${ref.service} present (${ctx.secrets.describe(ref)})` }
        : { id: ref.service, status: SECRET_SEVERITY[ref.service], message: `${ref.service} missing — bs secrets set ${ref.service}  (${ctx.secrets.describe(ref)})` });
    }
    return out;
  },
};
