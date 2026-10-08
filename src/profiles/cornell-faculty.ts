import { desktopInference } from "../artifacts/desktop-inference.ts";
import { desktopMcp } from "../artifacts/desktop-mcp.ts";
import { desktopSkills } from "../artifacts/desktop-skills.ts";
import { legacySubscription } from "../artifacts/legacy-subscription.ts";
import { hostedConnectors } from "../artifacts/hosted-connectors.ts";
import { prereqs } from "../artifacts/prereqs.ts";
import { secrets } from "../artifacts/secrets.ts";
import type { Profile } from "../engine/profile.ts";

/**
 * Desktop-only gateway profile for faculty/staff moving off a personal subscription (spec 2026-09-30-cornell-migration-assistant-design.md §3).
 * This repo is public: the profile holds PUBLIC values only. The gateway address below is a deliberate non-resolving placeholder
 * (`.invalid`, RFC 2606), not a real endpoint — each run supplies the published address through `--gateway-url <url>` or the `CORNELL_GATEWAY_URL` env var (flag wins; https origin only, no path), so this file stays value-free. The published address itself is still an open question, see MeCP
 * project:boot-slapper/cornell-migration-assistant. `bs onboard` refuses while any `.invalid` placeholder remains; `bs plan`/`doctor` run but the live gateway checks cannot pass.
 */
const GATEWAY = "https://gateway.example.invalid";

export const cornellFaculty: Profile = {
  name: "cornell-faculty",
  provider: "gateway",
  surfaces: ["desktop"],
  artifacts: [prereqs, legacySubscription, secrets, desktopInference, desktopMcp, desktopSkills, hostedConnectors],
  options: {
    // Trimmed prereqs: Desktop + the managed-policy gate only (no git/jq/python/node/claude on a faculty box).
    prereqs: { trimmed: true, refuseManaged: true },
    secrets: { services: ["cornell-ai-gateway"] },
    "desktop-inference": { baseUrl: GATEWAY },
    // Profile-supplied servers replace the owner's ~/.claude/mcp/gateway.json and drop the claude-config requirement. One credential (the gateway service), sent header-only via a helper.
    "desktop-mcp": {
      servers: { cornell_secure_tools: { type: "http", url: `${GATEWAY}/mcp/`, headers: { "x-litellm-api-key": "Bearer ${GATEWAY_KEY}" } } },
      tokens: { GATEWAY_KEY: "cornell-ai-gateway" },
      baseUrl: GATEWAY,
    },
    // No owner dotclaude on a faculty box. skills stays empty and no sourceDir is set until the Q5 never-3P-box probe says where a personal skills folder lives; the engine now resolves a home-relative sourceDir (`~/...`).
    "desktop-skills": { skills: [], fromClaudeConfig: false },
    "hosted-connectors": {
      connectors: ["Gmail", "Google Calendar", "Google Drive"],
      features: ["Claude in Chrome", "claude.ai web access", "Voice mode", "chat-history search"],
    },
  },
};
