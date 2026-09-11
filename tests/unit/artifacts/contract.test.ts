import { describe, expect, it } from "vitest";
import { withOpts } from "../../../src/engine/artifact.ts";
import { applyPlan } from "../../../src/engine/run.ts";
import { resolvePlan } from "../../../src/engine/plan.ts";
import { aca34 } from "../../../src/profiles/aca34.ts";
import { makeCtx } from "../helpers.ts";

// Invariant 1 (spec): detect() and verify() never write, and only ever run a small, well-known
// set of read-only probes. This is exercised here for every artifact in the aca34 profile —
// tests/unit/artifacts/claude-config.test.ts and gateway-launch.test.ts each check the same
// thing for one artifact in more depth (including idempotency of a real apply cycle).

const allTools = { git: "/usr/bin/git", curl: "/usr/bin/curl", jq: "/opt/jq", python3: "/usr/bin/python3", node: "/usr/local/bin/node", claude: "/h/.local/bin/claude", npm: "/usr/local/bin/npm" };

function benignHandlers(io: { on: (m: (c: string, a: string[]) => boolean, h: (c: { cmd: string; args: string[] }) => { code: number; stdout: string; stderr: string }) => void }) {
  // git rev-parse --show-toplevel: not a checkout (adopt-in-place path; no further git calls follow)
  io.on((c, a) => c === "git" && a.includes("--show-toplevel"), () => ({ code: 128, stdout: "", stderr: "not a git repository" }));
  io.on((c) => c === "security", () => ({ code: 0, stdout: "tok\n", stderr: "" }));
  io.on((c) => c === "powershell", () => ({ code: 44, stdout: "", stderr: "" }));
  io.on((c, a) => c === "node" && a[0] === "--version", () => ({ code: 0, stdout: "v22.12.0\n", stderr: "" }));
  io.on((c) => c === "bash", () => ({ code: 0, stdout: "", stderr: "" }));
}

function assertAllowedCall(call: { cmd: string; args: string[] }) {
  const { cmd, args } = call;
  if (cmd === "git") { const sub = args[0] === "-C" ? args[2] : args[0]; expect(["rev-parse", "status", "ls-remote", "--exec-path"]).toContain(sub); return; }
  if (cmd === "security") { expect(args[0]).toBe("find-generic-password"); return; }   // any service — the value is read in-process and never written
  if (cmd === "powershell") return;      // read-only PasswordVault / $PROFILE / Get-AppxPackage probes
  if (cmd === "ssh") return;             // BatchMode auth probe
  if (cmd === "node") { expect(args[0] === "--version" || (/dist[\\/]cli\.js$/.test(args[0]) && args[1] === "doctor")).toBe(true); return; }
  if (cmd === "bash") { expect(args[0]).toMatch(/sync-memory$/); expect(args.at(-1)).toBe("list"); return; }
  if (cmd === "plutil") { expect(args.slice(0, 4)).toEqual(["-convert", "xml1", "-o", "-"]); return; }   // managed plist → xml on stdout
  if (cmd === "reg") { expect(args[0]).toBe("query"); return; }
  if (cmd === "pgrep" || cmd === "tasklist") return;   // is Desktop running
  throw new Error(`detect/verify made an unexpected exec call: ${cmd} ${JSON.stringify(args)}`);
}

describe("artifact contract: detect/verify never write and only run allowlisted read-only probes", () => {
  for (const artifact of aca34.artifacts) {
    it(`${artifact.id}`, async () => {
      const { ctx, io } = await makeCtx({
        path: allTools,
        dirs: ["/h/.claude"],
        files: { "/h/.config/mecp/api_key": "k\n" },
        env: { USER: "aca34" },
        opts: aca34.options[artifact.id] ?? {},
      });
      benignHandlers(io);
      const c = withOpts(ctx, aca34.options[artifact.id]);
      await artifact.detect(c);
      await artifact.verify(c);
      expect(io.writes).toEqual([]);
      for (const call of io.calls) assertAllowedCall(call);
      for (const f of io.fetches) expect(f.init.method ?? "GET", `${artifact.id} fetch ${f.url}`).toBe("GET");
    });
  }

  describe("… with Claude Desktop installed", () => {
    for (const artifact of aca34.artifacts) {
      it(`${artifact.id}`, async () => {
        const { ctx, io } = await makeCtx({
          path: allTools,
          dirs: ["/h/.claude", "/Applications/Claude.app"],
          files: {
            "/h/.config/mecp/api_key": "k\n",
            "/Applications/Claude.app/Contents/Info.plist": "<plist><dict><key>CFBundleShortVersionString</key><string>1.49585.0</string></dict></plist>",
          },
          env: { USER: "aca34" },
          opts: aca34.options[artifact.id] ?? {},
        });
        benignHandlers(io);
        io.on((c) => c === "plutil", () => ({ code: 0, stdout: "<plist><dict/></plist>", stderr: "" }));
        const c = withOpts(ctx, aca34.options[artifact.id]);
        await artifact.detect(c);
        await artifact.verify(c);
        expect(io.writes).toEqual([]);
        for (const call of io.calls) assertAllowedCall(call);
        for (const f of io.fetches) expect(f.init.method ?? "GET", `${artifact.id} fetch ${f.url}`).toBe("GET");
      });
    }
  });

  it("apply-twice idempotency (cheap, generic subset): prereqs and secrets plan no steps once already present", async () => {
    const { ctx, io } = await makeCtx({
      path: allTools,
      env: { USER: "aca34" },
      files: { "/h/.config/mecp/api_key": "k\n" },
    });
    benignHandlers(io);
    const profile = { ...aca34, artifacts: aca34.artifacts.filter((a) => a.id === "prereqs" || a.id === "secrets") };
    const plan1 = await resolvePlan(profile, ctx);
    expect(plan1.flatMap((p) => p.steps)).toEqual([]);
    await applyPlan(plan1, ctx);
    const plan2 = await resolvePlan(profile, ctx);
    expect(plan2.flatMap((p) => p.steps)).toEqual([]);
    expect(io.writes).toEqual([]);
  });

  it("capture never writes, and device-bound / non-transferable artifacts capture no files", async () => {
    for (const artifact of aca34.artifacts) {
      if (!artifact.capture) continue;
      const { ctx, io } = await makeCtx({ path: allTools, dirs: ["/h/.claude"], env: { USER: "aca34" }, opts: aca34.options[artifact.id] ?? {} });
      benignHandlers(io);
      const b = await artifact.capture(withOpts(ctx, aca34.options[artifact.id]));
      expect(io.writes, artifact.id).toEqual([]);
      if (artifact.portability === "device-bound" || artifact.portability === "non-transferable") expect(b.files, artifact.id).toEqual([]);
    }
  });
});
