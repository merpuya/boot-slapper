import { InteractiveRequired, type Ctx } from "../../src/engine/artifact.ts";
import { probeEnv, resolveEnv, type Provider, type Surface } from "../../src/engine/env.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { FakeIo } from "../../src/engine/io.ts";
import { selectStore } from "../../src/engine/secrets/store.ts";

type FakeInit = ConstructorParameters<typeof FakeIo>[0];

export async function makeCtx(init: FakeInit & { provider?: Provider; surface?: Surface; interactive?: boolean; opts?: Record<string, unknown>; answers?: Record<string, string> } = {}) {
  const io = new FakeIo(init);
  // FakeIo.which reads pathMap; a key mapped to undefined means "not on PATH".
  const env = resolveEnv(await probeEnv(io), init.provider ?? "gateway", init.surface ?? "code");
  const events: EngineEvent[] = [];
  const interactive = init.interactive ?? false;
  const ctx: Ctx = {
    env, io, secrets: selectStore(env, io), interactive, opts: init.opts ?? {},
    prompt: {
      secret: async (label) => { if (!interactive) throw new InteractiveRequired(label); return init.answers?.[label] ?? ""; },
      text: async (label, fallback) => { if (!interactive) throw new InteractiveRequired(label); return init.answers?.[label] ?? fallback ?? ""; },
      confirm: async () => true,
      gate: async () => {},
    },
    emit: (e) => events.push(e),
  };
  return { ctx, io, env, events };
}
