import { render } from "ink";
import type { Prompter } from "../../engine/artifact.ts";
import { buildCtx } from "../../engine/ctx.ts";
import type { EngineEvent } from "../../engine/events.ts";
import type { Io } from "../../engine/io.ts";
import type { Profile } from "../../engine/profile.ts";
import { App } from "./App.tsx";
import type { Action } from "./model.ts";

export interface TuiStreams { stdout: NodeJS.WriteStream; stdin: NodeJS.ReadStream }
export interface TuiOpts {
  mode: "onboard" | "doctor"; profile: Profile; io: Io;
  filter?: { only?: string[]; skip?: string[] };
  log?: { emit(e: EngineEvent): void };
  streams?: TuiStreams;
  /** Ink writes every full frame (tests; also defeats Ink's CI-mode frame suppression). */
  debug?: boolean;
}

/** Renders the Ink skin over the same engine calls the headless runner makes; resolves with the exit code. */
export function runTui(o: TuiOpts): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let code = 1;
    const makeCtx = (emit: (a: Action) => void, prompt: Prompter) =>
      buildCtx(o.io, o.profile, { interactive: true, prompt, emit: (e) => { emit(e); o.log?.emit(e); } });
    const inst = render(
      <App mode={o.mode} profile={o.profile} filter={o.filter ?? {}} makeCtx={makeCtx} onExit={(c) => { code = c; }} />,
      { stdout: o.streams?.stdout ?? process.stdout, stdin: o.streams?.stdin ?? process.stdin, exitOnCtrlC: true, patchConsole: false, debug: o.debug ?? false },
    );
    inst.waitUntilExit().then(() => resolve(code), reject);
  });
}
