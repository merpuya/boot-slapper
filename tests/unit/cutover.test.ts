import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("staged cutover files", () => {
  it("bootstrap.sh shim is ≤ 15 lines, keeps --doctor, delegates onboard, and falls back to install.sh", () => {
    const s = read("docs/cutover/staged/bootstrap.sh");
    expect(s.split("\n").filter((l) => l.trim()).length).toBeLessThanOrEqual(15);
    expect(s).toMatch(/--doctor/); expect(s).toMatch(/dist\/cli\.js" doctor --headless/); expect(s).toMatch(/dist\/cli\.js" onboard/);
    expect(s).toMatch(/raw\.githubusercontent\.com\/merpuya\/boot-slapper\/main\/install\.sh/);
    expect(s).not.toMatch(/\r/);
  });
  it("dotfiles step-3 replacements call the boot-slapper shims", () => {
    expect(read("docs/cutover/staged/dotfiles-install-step3.sh")).toMatch(/install\.sh \| bash/);
    expect(read("docs/cutover/staged/dotfiles-install-step3.ps1")).toMatch(/install\.ps1 \| iex/);
  });
  it("the runbook names every repo change from spec §6 gate 2 and the verification evidence", () => {
    const r = read("docs/cutover/gate-2-runbook.md");
    for (const s of ["dotclaude/bootstrap.sh", "dotfiles/install.sh", "dotfiles/install.ps1", "dotfiles/zsh/claude-gw.zsh", "docs/gateway-sessions.md", "doctor --json", "sync-memory", "Managed Configuration Report"]) expect(r).toContain(s);
  });
  it("the gate-2 shim PR drafts cover every repo change in the runbook and reference the staged files", () => {
    const pr = read("docs/cutover/gate-2-shim-prs.md");
    for (const s of ["staged/bootstrap.sh", "staged/gateway-sessions.md", "staged/dotfiles-install-step3.sh", "staged/dotfiles-install-step3.ps1", "zsh/claude-gw.zsh", "boot-slapper:claude-gw", "Do not apply before gate 2"]) expect(pr).toContain(s);
  });
});

// Behavioural probe of the staged shim's checkout-root resolution (same order as install.sh): a fake checkout is a dir holding a
// dist/cli.js that prints where it ran from, so the shim's own `exec node "$DIR/dist/cli.js"` reports which root it picked.
describe.skipIf(process.platform === "win32")("staged bootstrap.sh checkout-root probe", () => {
  const shim = join(process.cwd(), "docs/cutover/staged/bootstrap.sh");
  const fakeCheckout = (dir: string) => {
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "dist/cli.js"), 'console.log("ROOT=" + __dirname.replace(/[\\/]dist$/, ""));\n');
  };
  const run = (layout: { projects?: boolean; documents?: boolean; override?: "elsewhere" | "missing" }) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "bs-shim-")));
    try {
      const projects = join(home, "projects/boot-slapper");
      const documents = join(home, "Documents/Claude/projects/boot-slapper");
      const elsewhere = join(home, "elsewhere/boot-slapper");
      if (layout.projects) fakeCheckout(projects);
      if (layout.documents) fakeCheckout(documents);
      if (layout.override === "elsewhere") fakeCheckout(elsewhere);
      const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home };
      if (layout.override === "elsewhere") env.BOOT_SLAPPER_DIR = elsewhere;
      if (layout.override === "missing") env.BOOT_SLAPPER_DIR = join(home, "nowhere/boot-slapper");
      const r = spawnSync("bash", [shim, "--doctor"], { encoding: "utf8", env });
      return { r, home, projects, documents, elsewhere };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };

  it("both roots present: ~/projects wins", () => {
    const { r, projects } = run({ projects: true, documents: true });
    expect(r.stdout.trim()).toBe(`ROOT=${projects}`);
  });
  it("only ~/Documents/Claude/projects present: the Documents root is used", () => {
    const { r, documents } = run({ documents: true });
    expect(r.stdout.trim()).toBe(`ROOT=${documents}`);
  });
  it("neither present: the default ~/projects path is reported as not installed", () => {
    const { r, projects } = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`not installed at ${projects} `);
  });
  it("BOOT_SLAPPER_DIR wins even when both default roots exist", () => {
    const { r, elsewhere } = run({ projects: true, documents: true, override: "elsewhere" });
    expect(r.stdout.trim()).toBe(`ROOT=${elsewhere}`);
  });
  it("BOOT_SLAPPER_DIR wins even when it does not exist and a Documents root does", () => {
    const { r, home } = run({ documents: true, override: "missing" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`not installed at ${join(home, "nowhere/boot-slapper")} `);
  });
});
