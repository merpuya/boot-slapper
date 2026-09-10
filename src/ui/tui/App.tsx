import { Box, Text, useApp } from "ink";
import { useEffect, useReducer, useState } from "react";
import type { Ctx, Prompter } from "../../engine/artifact.ts";
import type { Env } from "../../engine/env.ts";
import { selectArtifacts } from "../../engine/plan.ts";
import type { Profile } from "../../engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "../../engine/run.ts";
import { CheckRows, Notes, PlanRows } from "./components.tsx";
import { initialModel, reduce, type Action } from "./model.ts";
import { PromptLine } from "./PromptLine.tsx";
import { bridgePrompter, type Pending } from "./prompter.ts";

export interface AppProps {
  mode: "onboard" | "doctor";
  profile: Profile;
  filter: { only?: string[]; skip?: string[] };
  /** Built by runTui with the real Io/store; the App only supplies where events and prompts go. */
  makeCtx(emit: (a: Action) => void, prompt: Prompter): Promise<Ctx>;
  onExit(code: number): void;
}

export function App({ mode, profile, filter, makeCtx, onExit }: AppProps) {
  const [m, dispatch] = useReducer(reduce, undefined, initialModel);
  const [pending, setPending] = useState<Pending | null>(null);
  const [env, setEnv] = useState<Env | null>(null);
  const { exit, waitUntilRenderFlush } = useApp();

  useEffect(() => {
    (async () => {
      const ctx = await makeCtx(dispatch, bridgePrompter(setPending));
      setEnv(ctx.env);
      let code = 0;
      if (mode === "doctor") {
        dispatch({ type: "artifacts", list: selectArtifacts(profile).map((a) => ({ id: a.id, portability: a.portability })) });
        dispatch({ type: "phase", phase: "verifying" });
        code = worstStatus(await verifyAll(profile, ctx)) === "error" ? 1 : 0;
      } else {
        const plan = await resolvePlan(profile, ctx, filter);
        dispatch({ type: "plan:resolved", plan });
        dispatch({ type: "phase", phase: "confirm" });
        if (!(await ctx.prompt.confirm("Apply this plan?"))) {
          dispatch({ type: "phase", phase: "aborted" }); dispatch({ type: "exit", code: 3 });
          await waitUntilRenderFlush(); onExit(3); exit(); return;
        }
        dispatch({ type: "phase", phase: "applying" });
        const res = await applyPlan(plan, ctx);
        code = res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
      }
      // Ink schedules the reducer's commit rather than flushing it synchronously with dispatch();
      // without this wait, exit()'s teardown can race ahead and drop the final render entirely.
      dispatch({ type: "exit", code }); await waitUntilRenderFlush(); onExit(code); exit();
    })().catch((e: unknown) => { onExit(1); exit(e instanceof Error ? e : new Error(String(e))); });
  }, []);

  const hasChecks = m.rows.some((r) => r.checks.length > 0);
  return (
    <Box flexDirection="column">
      <Text bold>boot-slapper {mode} — profile {profile.name}{env ? ` on ${env.label} (${env.os}, ${env.provider})` : ""}</Text>
      {mode === "onboard" && <PlanRows rows={m.rows} />}
      {m.notes.length > 0 && <Notes notes={m.notes} />}
      {hasChecks && <CheckRows rows={m.rows} />}
      {pending && <PromptLine pending={pending} />}
      {m.phase === "aborted" && <Text color="yellow">aborted — nothing applied</Text>}
    </Box>
  );
}
