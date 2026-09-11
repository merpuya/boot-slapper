import { readFileSync } from "node:fs";
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
});
