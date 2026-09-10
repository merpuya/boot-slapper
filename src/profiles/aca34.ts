import { claudeConfig } from "../artifacts/claude-config.ts";
import { gatewayLaunch } from "../artifacts/gateway-launch.ts";
import { mct } from "../artifacts/mct.ts";
import { prereqs } from "../artifacts/prereqs.ts";
import { projectMemory } from "../artifacts/project-memory.ts";
import { secrets } from "../artifacts/secrets.ts";
import type { Profile } from "../engine/profile.ts";

export const aca34: Profile = {
  name: "aca34",
  provider: "gateway",
  surfaces: ["code"],                       // "desktop" joins in Phase 3
  artifacts: [prereqs, claudeConfig, secrets, gatewayLaunch, projectMemory, mct],
  options: {
    "claude-config": { sshUrl: "git@github.com:merpuya/dotclaude.git", httpsUrl: "https://github.com/merpuya/dotclaude.git" },
    secrets: { services: ["cornell-ai-gateway", "mecp-device-token", "mecp-api-key", "mct-sync-token"] },
    "gateway-launch": { baseUrl: "https://api.ai.it.cornell.edu" },
    "project-memory": { sshUrl: "git@github.com:merpuya/claude-memory-sync.git", httpsUrl: "https://github.com/merpuya/claude-memory-sync.git" },
    // deviceIds: device label → MeCP device slug (fleet convention: mct device id == MeCP slug). Verified on JCB-AL-ACA34 from its ~/.mct/config.json;
    // JCB-AL-AV01 follows the slug in MeCP. A new box without an entry is asked interactively.
    mct: { sshUrl: "git@github.com:merpuya/me-count-token.git", httpsUrl: "https://github.com/merpuya/me-count-token.git", syncUrl: "https://mct.kearnsapuya.net",
      deviceIds: { "JCB-AL-ACA34": "macbook-aca34", "JCB-AL-AV01": "jcb-al-av01" } },
  },
};
