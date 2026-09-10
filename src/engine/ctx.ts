import type { Ctx, Prompter } from "./artifact.ts";
import { probeEnv, resolveEnv } from "./env.ts";
import type { EngineEvent } from "./events.ts";
import type { Io } from "./io.ts";
import type { Profile } from "./profile.ts";
import { selectStore } from "./secrets/store.ts";

/** One context builder for every skin: same env probe, same store, same per-artifact options. */
export async function buildCtx(io: Io, profile: Profile, o: { interactive: boolean; prompt: Prompter; emit: (e: EngineEvent) => void }): Promise<Ctx> {
  const env = resolveEnv(await probeEnv(io), profile.provider, profile.surfaces[0]);
  return { env, io, secrets: selectStore(env, io), prompt: o.prompt, interactive: o.interactive, opts: profile.options, emit: o.emit };
}
