#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { InteractiveRequired } from "./engine/artifact.ts";
import { captureBundle, SecretScanError, type CaptureResult } from "./engine/capture.ts";
import { buildCtx } from "./engine/ctx.ts";
import { pj, probeEnv, toOs } from "./engine/env.ts";
import type { EngineEvent } from "./engine/events.ts";
import { RealIo, type Io } from "./engine/io.ts";
import type { Profile } from "./engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "./engine/run.ts";
import { defaultAccount, type SecretService } from "./engine/secrets/store.ts";
import { aca34 } from "./profiles/aca34.ts";
import { doctorSummary, headlessReporter, renderChecksText, renderPlanText, runLogWriter, type Sink } from "./ui/headless.ts";
import { headlessPrompter, ttyPrompter } from "./ui/prompt.ts";
import { runTui, type TuiStreams } from "./ui/tui/index.tsx";

const PROFILES: Record<string, Profile> = { aca34 };
const SERVICES: SecretService[] = ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"];

const USAGE = `usage: bs — boot-slapper
  bs env
  bs plan    [--profile aca34] [--only a,b] [--skip a,b]
  bs doctor  [--profile aca34] [--json] [--headless]
  bs onboard [--profile aca34] [--auto] [--headless] [--only a,b] [--skip a,b]
  bs capture --out <dir> [--profile aca34]
  bs secrets set|check <${SERVICES.join("|")}>
  --auto      no prompts: interactive steps are skipped with a warning (implies --headless)
  --headless  line output instead of the Ink screens (also the default when stdin is not a terminal or CI is set)
  --only desktop-inference,desktop-mcp,desktop-skills   # just the Claude Desktop (3P) surface`;

interface Deps { io?: Io; stdout?: Sink; stderr?: Sink; interactive?: boolean; tui?: boolean; streams?: TuiStreams; debug?: boolean }

const ctxFor = (io: Io, profile: Profile, interactive: boolean, emit: (e: EngineEvent) => void) =>
  buildCtx(io, profile, { interactive, prompt: interactive ? ttyPrompter() : headlessPrompter(), emit });

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const io = deps.io ?? new RealIo();
  const stdout = deps.stdout ?? { write: (l: string) => process.stdout.write(l + "\n") };
  const stderr = deps.stderr ?? { write: (l: string) => process.stderr.write(l + "\n") };
  const [cmd, ...rest] = argv;
  let values: Record<string, string | boolean | undefined>, positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      profile: { type: "string", default: "aca34" }, json: { type: "boolean" }, auto: { type: "boolean" }, headless: { type: "boolean" },
      only: { type: "string" }, skip: { type: "string" }, out: { type: "string" },
    } }));
  } catch (e) { stderr.write(String(e instanceof Error ? e.message : e)); stderr.write(USAGE); return 2; }

  const profile = PROFILES[String(values.profile)];
  if (!profile && cmd !== "env") { stderr.write(`unknown profile: ${String(values.profile)}`); stderr.write(USAGE); return 2; }
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : undefined);
  const filter = { only: list(values.only), skip: list(values.skip) };
  const interactive = deps.interactive ?? (!values.auto && Boolean(process.stdin.isTTY));
  const tui = deps.tui ?? (interactive && !values.headless && !process.env.CI);
  const os = toOs(io.platform);

  switch (cmd) {
    case "env": { stdout.write(JSON.stringify(await probeEnv(io), null, 2)); return 0; }
    case "plan": {
      const ctx = await ctxFor(io, profile, false, () => {});
      stdout.write(renderPlanText(await resolvePlan(profile, ctx, filter)).trimEnd());
      return 0;
    }
    case "doctor": {
      if (tui && !values.json) {
        try { return await runTui({ mode: "doctor", profile, io, streams: deps.streams, debug: deps.debug }); }
        catch (e) { stderr.write(`tui failed: ${e instanceof Error ? e.message : String(e)}`); return 1; }
      }
      const ctx = await ctxFor(io, profile, false, () => {});
      const checks = await verifyAll(profile, ctx);
      const status = worstStatus(checks);
      if (values.json) stdout.write(JSON.stringify({ profile: profile.name, env: ctx.env, status, checks }, null, 2));
      else stdout.write(renderChecksText(checks).trimEnd());
      return status === "error" ? 1 : 0;
    }
    case "onboard": {
      const log = runLogWriter(io, pj(os, io.home, ".config", "boot-slapper", "runs"), new Date());
      if (tui) {
        try {
          const code = await runTui({ mode: "onboard", profile, io, filter, log, streams: deps.streams, debug: deps.debug });
          stdout.write(`==> run log: ${log.path}`);
          await log.done();
          return code;
        } catch (e) {
          stderr.write(`tui failed: ${e instanceof Error ? e.message : String(e)}`);
          stdout.write(`==> run log: ${log.path}`);
          await log.done();
          return 1;
        }
      }
      const report = headlessReporter(stdout);
      const ctx = await ctxFor(io, profile, interactive, (e) => { report(e); log.emit(e); });
      stdout.write(`==> boot-slapper onboard — profile ${profile.name} on ${ctx.env.label} (${ctx.env.os}, ${ctx.env.provider}${interactive ? "" : ", --auto"})`);
      const plan = await resolvePlan(profile, ctx, filter);
      stdout.write(renderPlanText(plan).trimEnd());
      if (interactive && !(await ctx.prompt.confirm("Apply this plan?"))) { stdout.write("aborted"); await log.done(); return 3; }
      const res = await applyPlan(plan, ctx);
      stdout.write(doctorSummary(res.checks));
      stdout.write(`==> run log: ${log.path}`);
      await log.done();
      return res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
    }
    case "capture": {
      const out = typeof values.out === "string" ? values.out : "";
      if (!out) { stderr.write("bs capture needs --out <dir>"); stderr.write(USAGE); return 2; }
      if (await io.exists(pj(os, out, "manifest.json"))) { stderr.write(`${out} already holds a bundle (manifest.json) — choose another --out`); return 1; }
      const ctx = await ctxFor(io, profile, false, headlessReporter(stdout));
      let res: CaptureResult;
      try { res = await captureBundle(profile, ctx); }
      catch (e) { if (e instanceof SecretScanError) { stderr.write(e.message); return 1; } throw e; }
      for (const f of res.files) await io.writeFile(pj(os, out, ...f.path.split("/")), f.content);
      await io.writeFile(pj(os, out, "instructions.md"), res.instructions);
      await io.writeFile(pj(os, out, "manifest.json"), JSON.stringify(res.manifest, null, 2) + "\n"); // last: a manifest means "complete"
      stdout.write(`==> bundle written: ${out} (${res.files.length} file(s), ${res.manifest.artifacts.length} artifact(s))`);
      return 0;
    }
    case "secrets": {
      const [op, svc] = positionals;
      if (!["set", "check"].includes(op) || !SERVICES.includes(svc as SecretService)) { stderr.write(USAGE); return 2; }
      const ctx = await ctxFor(io, profile ?? aca34, interactive, () => {});
      const ref = { service: svc as SecretService, account: defaultAccount(io) };
      if (op === "check") {
        const present = (await ctx.secrets.get(ref)) !== null;
        stdout.write(`${svc}: ${present ? "present" : "missing"} (${ctx.secrets.describe(ref)})`);
        return present ? 0 : 1;
      }
      let value: string;
      try { value = (await ctx.prompt.secret(`Paste ${svc}`)).trim(); }
      catch (e) {
        if (e instanceof InteractiveRequired) { stderr.write(`bs secrets set needs an interactive terminal (${e.message})`); return 2; }
        throw e;
      }
      if (!value) { stderr.write("blank — nothing stored"); return 1; }
      await ctx.secrets.set(ref, value);
      stdout.write(`${svc}: stored (${ctx.secrets.describe(ref)})`);
      return 0;
    }
    default: stderr.write(USAGE); return 2;
  }
}

if ((process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) || process.argv[1]?.endsWith("/dist/cli.js") || process.argv[1]?.endsWith("\\dist\\cli.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
