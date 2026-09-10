import { claudeConfig } from "../artifacts/claude-config.ts";
import { gatewayLaunch } from "../artifacts/gateway-launch.ts";
import { prereqs } from "../artifacts/prereqs.ts";
import { secrets } from "../artifacts/secrets.ts";
import type { Profile } from "../engine/profile.ts";

export const aca34: Profile = {
  name: "aca34",
  provider: "gateway",
  surfaces: ["code"],                       // "desktop" joins in Phase 3
  artifacts: [prereqs, claudeConfig, secrets, gatewayLaunch],
  options: {
    "claude-config": { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" },
    secrets: { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key"] },
    "gateway-launch": { baseUrl: "https://api.ai.it.cornell.edu" },
  },
};
