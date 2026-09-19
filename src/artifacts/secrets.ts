import type { Artifact, Bundle, Check, Ctx, State, Step } from "../engine/artifact.ts";
import { checkShape } from "../engine/secrets/shape.ts";
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
      const value = await ctx.secrets.get(ref);
      if (value === null) {
        out.push({ id: ref.service, status: SECRET_SEVERITY[ref.service], message: `${ref.service} missing — bs secrets set ${ref.service}  (${ctx.secrets.describe(ref)})` });
        continue;
      }
      // Present is not the same as right. A wrong-but-working credential reports ok forever
      // otherwise — "present" was true and useless for six weeks on yogaNovo. warn, never error:
      // the value authenticates, so this is hygiene, and an error would fail a working box.
      const shape = checkShape(ref.service, value);
      out.push(shape && !shape.ok
        ? { id: ref.service, status: "warn", message: `${ref.service} present but suspect — ${shape.reason}  (${ctx.secrets.describe(ref)})` }
        : { id: ref.service, status: "ok", message: `${ref.service} present (${ctx.secrets.describe(ref)})` });
    }
    return out;
  },

  async capture(ctx): Promise<Bundle> {
    return { files: [], instructions: refs(ctx).map((r) => `bs secrets set ${r.service} — ${SECRET_LABELS[r.service]}`) };
  },
};
