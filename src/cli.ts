#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { InteractiveRequired, type Ctx } from "./engine/artifact.ts";
import { probeEnv, resolveEnv } from "./engine/env.ts";
import type { EngineEvent } from "./engine/events.ts";
import { RealIo, type Io } from "./engine/io.ts";
import type { Profile } from "./engine/profile.ts";
import { applyPlan, resolvePlan, verifyAll, worstStatus } from "./engine/run.ts";
import { defaultAccount, selectStore, type SecretService } from "./engine/secrets/store.ts";
import { aca34 } from "./profiles/aca34.ts";
import { headlessReporter, renderChecksText, renderPlanText, runLogWriter, type Sink } from "./ui/headless.ts";
import { headlessPrompter, ttyPrompter } from "./ui/prompt.ts";

const PROFILES: Record<string, Profile> = { aca34 };
const SERVICES: SecretService[] = ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"];

const USAGE = `usage: bs — boot-slapper
  bs env
  bs plan    [--profile aca34] [--only a,b] [--skip a,b]
  bs doctor  [--profile aca34] [--json]
  bs onboard [--profile aca34] [--auto] [--only a,b] [--skip a,b]
  bs secrets set|check <${SERVICES.join("|")}>`;

interface Deps { io?: Io; stdout?: Sink; stderr?: Sink; interactive?: boolean }

async function buildCtx(io: Io, profile: Profile, interactive: boolean, emit: (e: EngineEvent) => void): Promise<Ctx> {
  const env = resolveEnv(await probeEnv(io), profile.provider, profile.surfaces[0]);
  return { env, io, secrets: selectStore(env, io), prompt: interactive ? ttyPrompter() : headlessPrompter(), interactive, opts: profile.options, emit };
}

export async function main(argv: string[], deps: Deps = {}): Promise<number> {
  const io = deps.io ?? new RealIo();
  const stdout = deps.stdout ?? { write: (l: string) => process.stdout.write(l + "\n") };
  const stderr = deps.stderr ?? { write: (l: string) => process.stderr.write(l + "\n") };
  const [cmd, ...rest] = argv;
  let values: Record<string, string | boolean | undefined>, positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      profile: { type: "string", default: "aca34" }, json: { type: "boolean" }, auto: { type: "boolean" },
      only: { type: "string" }, skip: { type: "string" },
    } }));
  } catch (e) { stderr.write(String(e instanceof Error ? e.message : e)); stderr.write(USAGE); return 2; }

  const profile = PROFILES[String(values.profile)];
  if (!profile && cmd !== "env") { stderr.write(`unknown profile: ${String(values.profile)}`); stderr.write(USAGE); return 2; }
  const list = (v: unknown) => (typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : undefined);
  const filter = { only: list(values.only), skip: list(values.skip) };
  const interactive = deps.interactive ?? (!values.auto && Boolean(process.stdin.isTTY));

  switch (cmd) {
    case "env": { stdout.write(JSON.stringify(await probeEnv(io), null, 2)); return 0; }
    case "plan": {
      const ctx = await buildCtx(io, profile, false, () => {});
      stdout.write(renderPlanText(await resolvePlan(profile, ctx, filter)).trimEnd());
      return 0;
    }
    case "doctor": {
      const ctx = await buildCtx(io, profile, false, () => {});
      const checks = await verifyAll(profile, ctx);
      const status = worstStatus(checks);
      if (values.json) stdout.write(JSON.stringify({ profile: profile.name, env: ctx.env, status, checks }, null, 2));
      else stdout.write(renderChecksText(checks).trimEnd());
      return status === "error" ? 1 : 0;
    }
    case "onboard": {
      const startedAt = new Date();
      const home = io.home;
      const log = runLogWriter(io, path.join(home, ".config", "boot-slapper", "runs"), startedAt);
      const report = headlessReporter(stdout);
      const ctx = await buildCtx(io, profile, interactive, (e) => { report(e); log.emit(e); });
      stdout.write(`==> boot-slapper onboard — profile ${profile.name} on ${ctx.env.label} (${ctx.env.os}, ${ctx.env.provider}${interactive ? "" : ", --auto"})`);
      const plan = await resolvePlan(profile, ctx, filter);
      stdout.write(renderPlanText(plan).trimEnd());
      if (interactive && !(await ctx.prompt.confirm("Apply this plan?"))) { stdout.write("aborted"); await log.done(); return 3; }
      const res = await applyPlan(plan, ctx);
      stdout.write(renderChecksText(res.checks).trimEnd());
      stdout.write(`==> run log: ${log.path}`);
      await log.done();
      return res.failed.length || worstStatus(res.checks) === "error" ? 1 : 0;
    }
    case "secrets": {
      const [op, svc] = positionals;
      if (!["set", "check"].includes(op) || !SERVICES.includes(svc as SecretService)) { stderr.write(USAGE); return 2; }
      const ctx = await buildCtx(io, profile ?? aca34, interactive, () => {});
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

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/dist/cli.js") || process.argv[1]?.endsWith("\\dist\\cli.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
