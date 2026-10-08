import type { Artifact, Bundle, Check, Ctx, State } from "../engine/artifact.ts";
import { ORG_SENTINEL, readJson, resolveDesktopStore } from "../engine/desktop.ts";
import { pj } from "../engine/env.ts";

/**
 * Spec 2026-09-30-cornell-migration-assistant-design.md section 4. The SOURCE-side view of the machine: what a personal claude.ai
 * subscription currently holds that cannot move. Strictly read-only: `apply` is empty by invariant, nothing under the first-party
 * Claude store is ever opened for writing, and no credential is read. Q4 default: sign-in is NOT detected, only store presence.
 */
export const CHECKLIST_MARKER = "<!-- boot-slapper migration checklist: safe to regenerate -->";

export interface LegacySkill { name: string; where: "cowork-store" | "kb-folder" }
export interface LegacyFacts {
  firstPartyStore: string;
  /** Q4 default: the first-party data folder exists. Says nothing about whether anyone is signed in. */
  firstPartyPresent: boolean;
  /** A Claude-3p configuration library already exists (a previous third-party setup). */
  thirdPartyAlready: boolean;
  skills: LegacySkill[];
  /** Names only. Commands, args and env of a local server are never read into the facts. */
  mcpServers: { names: string[]; unreadable: boolean };
  /** Claude Code with an oauthAccount (the existing `subscription` provider probe). */
  codeSubscription: boolean;
}

const roaming = (ctx: Ctx) => ctx.io.env.APPDATA ?? pj("win32", ctx.env.home, "AppData", "Roaming");
const firstPartyStore = (ctx: Ctx) =>
  ctx.env.os === "darwin" ? pj("darwin", ctx.env.home, "Library", "Application Support", "Claude")
    : ctx.env.os === "win32" ? pj("win32", roaming(ctx), "Claude") : pj(ctx.env.os, ctx.env.home, ".config", "Claude");
/** The folder the faculty KB's appendix names for personal skills. A source to probe only; Q5 residue: whether it is ever populated on a never-3P box. */
const kbSkillsDir = (ctx: Ctx) =>
  ctx.env.os === "win32" ? pj("win32", ctx.env.home, "Claude", ".claude", "skills") : pj(ctx.env.os, ctx.env.home, "Documents", "Claude", ".claude", "skills");

async function skillNames(ctx: Ctx, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const n of (await ctx.io.readdir(dir)).sort()) if (await ctx.io.isDir(pj(ctx.env.os, dir, n))) out.push(n);
  return out;
}

export async function legacyFacts(ctx: Ctx): Promise<LegacyFacts> {
  const { io, env } = ctx;
  const store = firstPartyStore(ctx);
  const firstPartyPresent = await io.isDir(store);
  const tp = await resolveDesktopStore(io, env.os, env.home);
  const thirdPartyAlready = await io.exists(pj(env.os, tp.dir, "configLibrary", "_meta.json"));

  const skills = new Map<string, LegacySkill>();
  const root = pj(env.os, store, "local-agent-mode-sessions", "skills-plugin");
  for (const org of (await io.readdir(root)).sort()) {
    if (org === ORG_SENTINEL) continue;   // the 3P sentinel org is not the personal subscription's
    for (const acct of (await io.readdir(pj(env.os, root, org))).sort()) {
      for (const name of await skillNames(ctx, pj(env.os, root, org, acct, "skills"))) if (!skills.has(name)) skills.set(name, { name, where: "cowork-store" });
    }
  }
  for (const name of await skillNames(ctx, kbSkillsDir(ctx))) if (!skills.has(name)) skills.set(name, { name, where: "kb-folder" });

  const cfgPath = pj(env.os, store, "claude_desktop_config.json");
  let mcpServers: LegacyFacts["mcpServers"] = { names: [], unreadable: false };
  if (await io.exists(cfgPath)) {
    const j = await readJson(io, cfgPath);
    if (j === "invalid" || j === null) mcpServers = { names: [], unreadable: true };
    else {
      const m = (j as { mcpServers?: unknown }).mcpServers;
      mcpServers = { names: m && typeof m === "object" && !Array.isArray(m) ? Object.keys(m).sort() : [], unreadable: false };
    }
  }
  const cj = await readJson(io, pj(env.os, env.home, ".claude.json"));
  const codeSubscription = cj !== null && cj !== "invalid" && typeof cj.oauthAccount === "object" && cj.oauthAccount !== null;
  return { firstPartyStore: store, firstPartyPresent, thirdPartyAlready, skills: [...skills.values()].sort((a, b) => (a.where === b.where ? a.name.localeCompare(b.name) : a.where === "cowork-store" ? -1 : 1)), mcpServers, codeSubscription };
}

const summary = (f: LegacyFacts): string[] => [
  f.firstPartyPresent ? `first-party Claude Desktop data found at ${f.firstPartyStore} (sign-in status is not checked)` : "no first-party Claude Desktop data found",
  f.thirdPartyAlready ? "a third-party (Claude-3p) configuration already exists on this computer" : "no third-party configuration yet",
  f.skills.length ? `skills found: ${f.skills.map((s) => s.name).join(", ")}` : "no personal skills found",
  f.mcpServers.unreadable ? "local MCP servers: claude_desktop_config.json could not be read" : f.mcpServers.names.length ? `local MCP servers: ${f.mcpServers.names.join(", ")}` : "no local MCP servers found",
  f.codeSubscription ? "Claude Code is signed in with a subscription account" : "Claude Code has no subscription sign-in",
];

/** instructions.md: plain language, one section per item, checkboxes the tool never tracks. Deterministic (no timestamp), names only, no values. */
export function renderChecklist(f: LegacyFacts, hosted: { connectors?: string[]; features?: string[] }): string {
  const L: string[] = [CHECKLIST_MARKER, "", "# Before you move to the Cornell gateway: save this first", ""];
  L.push("Work through this list before you cancel anything. This tool only reads your computer to write the list: your claude.ai account is untouched, nothing is uploaded, and nothing is deleted. Cancel your personal subscription only after you have saved what you need.", "");
  if (f.firstPartyPresent) L.push(`Claude Desktop data from a personal account was found on this computer. This tool does not check whether you are signed in; it only sees that the data folder exists.`, "");
  else L.push("No Claude Desktop data from a personal account was found on this computer. If you use claude.ai in a browser or on another device, the items below still apply to that account.", "");
  if (f.thirdPartyAlready) L.push("Claude Desktop on this computer is already set up to use a third-party gateway. If that was this tool, nothing below is undone by running it again.", "");
  L.push("## 1. Conversation history", "", "- [ ] In claude.ai open Settings, Privacy, then Export data (web app or Claude Desktop, not the phone app). The download link arrives by email and expires after 24 hours, so download it as soon as it arrives. The export is an archive for you to keep; it cannot be imported into another account.", "- [ ] For any conversation you still need, copy out what matters.", "");
  L.push("## 2. Projects", "", "- [ ] For each Project, copy its custom instructions text into a document. Note which uploaded files it holds (see item 3).", "");
  L.push("## 3. Uploaded files", "", "- [ ] Download the files you still need from your Projects and conversations. The data export may not include Project files.", "");
  L.push("## 4. Custom instructions", "", "- [ ] In Settings, Profile, copy your personal preferences text so you can re-use it.", "");
  L.push("## 5. Skills found on this computer", "");
  if (f.skills.length) { L.push("These were found. This tool does not move them yet, so copy the folders you want to keep.", ""); for (const s of f.skills) L.push(`- [ ] ${s.name} (${s.where === "cowork-store" ? "Claude Desktop skills store" : "the Documents/Claude skills folder"})`); }
  else L.push("- none found");
  L.push("", "## 6. Local MCP servers", "");
  if (f.mcpServers.unreadable) L.push("- [ ] Your local Claude Desktop configuration file could not be read, so any local MCP servers are not listed. Check it by hand.");
  else if (f.mcpServers.names.length) { L.push("Add these again by hand if you still want them. Their settings are not copied and are not shown here, because they can contain passwords.", ""); for (const n of f.mcpServers.names) L.push(`- [ ] ${n}`); }
  else L.push("- none found");
  L.push("", "## 7. Connectors that stay on claude.ai", "");
  L.push(`- [ ] Connectors that are not available on the gateway: ${(hosted.connectors ?? []).join(", ") || "none listed"}. Note any content you rely on.`);
  if (hosted.features?.length) L.push(`- [ ] Features not available in Claude Desktop on the gateway: ${hosted.features.join(", ")}.`);
  L.push("");
  return L.join("\n");
}

export const legacySubscription: Artifact = {
  id: "legacy-subscription", surfaces: ["desktop"], portability: "device-bound", requires: [],
  async detect(ctx): Promise<State> { return { kind: "absent", details: summary(await legacyFacts(ctx)) }; },
  plan: () => [],
  async apply() {},   // empty by invariant: this artifact never writes
  async verify(ctx): Promise<Check[]> { return summary(await legacyFacts(ctx)).map((message, i) => ({ id: ["first-party", "third-party", "skills", "local-mcp", "code"][i], status: "info" as const, message })); },
  async capture(ctx): Promise<Bundle> { return { files: [], instructions: summary(await legacyFacts(ctx)) }; },
};
