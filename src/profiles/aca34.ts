import { claudeConfig } from "../artifacts/claude-config.ts";
import { desktopInference } from "../artifacts/desktop-inference.ts";
import { desktopMcp } from "../artifacts/desktop-mcp.ts";
import { desktopSkills } from "../artifacts/desktop-skills.ts";
import { gatewayLaunch } from "../artifacts/gateway-launch.ts";
import { hostedConnectors } from "../artifacts/hosted-connectors.ts";
import { mct } from "../artifacts/mct.ts";
import { openBrainAuth } from "../artifacts/open-brain-auth.ts";
import { plugins } from "../artifacts/plugins.ts";
import { prereqs } from "../artifacts/prereqs.ts";
import { projectMemory } from "../artifacts/project-memory.ts";
import { secrets } from "../artifacts/secrets.ts";
import type { Profile } from "../engine/profile.ts";

export const aca34: Profile = {
  name: "aca34",
  provider: "gateway",
  surfaces: ["code", "desktop"],
  artifacts: [prereqs, claudeConfig, secrets, gatewayLaunch, projectMemory, mct, plugins, desktopInference, desktopMcp, desktopSkills, openBrainAuth, hostedConnectors],
  options: {
    "claude-config": { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" },
    secrets: { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"] },
    "gateway-launch": { baseUrl: "https://api.ai.it.cornell.edu" },
    "project-memory": { sshUrl: "git@github.com:merpuya/claude-memory-sync.git", httpsUrl: "https://github.com/merpuya/claude-memory-sync.git" },
    // deviceIds: device label → MeCP device slug (fleet convention: mct device id == MeCP slug). Verified on JCB-AL-ACA34 from its ~/.mct/config.json;
    // JCB-AL-AV01 follows the slug in MeCP. A new box without an entry is asked interactively.
    mct: { sshUrl: "git@github.com:merpuya/me-count-token.git", httpsUrl: "https://github.com/merpuya/me-count-token.git", syncUrl: "https://mct.kearnsapuya.net",
      deviceIds: { "JCB-AL-ACA34": "macbook-aca34", "JCB-AL-AV01": "jcb-al-av01" } },
    // The set enabled on JCB-AL-ACA34 on 2026-09-10; plugins the owner keeps disabled — github, firecrawl, microsoft-docs,
    // plugin-dev, supabase, vercel, learning-output-style — are deliberately not listed.
    plugins: {
      marketplaces: [
        { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
        { name: "cornell-ai", source: "cu-aaii/claude-plugins-marketplace" },
      ],
      plugins: [
        "superpowers@claude-plugins-official", "context7@claude-plugins-official", "code-review@claude-plugins-official", "code-simplifier@claude-plugins-official",
        "commit-commands@claude-plugins-official", "feature-dev@claude-plugins-official", "frontend-design@claude-plugins-official", "mcp-server-dev@claude-plugins-official",
        "claude-code-setup@claude-plugins-official", "claude-md-management@claude-plugins-official", "explanatory-output-style@claude-plugins-official",
        "notion@claude-plugins-official", "playwright@claude-plugins-official", "ralph-loop@claude-plugins-official", "remember@claude-plugins-official",
        "security-guidance@claude-plugins-official", "skill-creator@claude-plugins-official",
        "pyright-lsp@claude-plugins-official", "swift-lsp@claude-plugins-official", "typescript-lsp@claude-plugins-official",
      ],
    },
    "desktop-inference": { baseUrl: "https://api.ai.it.cornell.edu" },
    "desktop-mcp": { tokens: { MECP_DEVICE_TOKEN: "mecp-device-token" } },
    // Cowork copies of dotclaude skills; mecp-conventions first (spec §4 row 10). Add names from ~/.claude/skills as they prove useful in Cowork.
    "desktop-skills": { skills: ["mecp-conventions"] },
    "open-brain-auth": { server: "openbrain" },
    // What the owner uses on claude.ai today that a gateway box cannot have (spec §4 row 12; 3P feature matrix 2026-09-10).
    "hosted-connectors": {
      connectors: ["Gmail", "Google Calendar", "Google Drive", "FGAC.ai (Google Workspace)", "Todoist", "Airtable", "Home Assistant", "Trello", "Wispr Flow", "n8n", "Shopify", "Supabase", "Vercel", "Cloudflare Developer Platform", "Microsoft Learn", "Context7", "AccuWeather"],
      features: ["Claude in Chrome", "claude.ai web access", "Voice mode", "Claude Design", "project and plugin sharing", "chat-history search"],
    },
  },
};
