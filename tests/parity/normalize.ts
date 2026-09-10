export type Status = "ok" | "warn" | "error";
export const PARITY_MAP: Array<{ id: string; bash: RegExp }> = [
  { id: "prereqs.git", bash: /prereq(?: missing)?: git\b/ }, { id: "prereqs.curl", bash: /prereq(?: missing)?: curl\b/ }, { id: "prereqs.jq", bash: /prereq(?: missing)?: jq\b/ },
  { id: "prereqs.python", bash: /prereq(?: missing)?: python/ }, { id: "prereqs.node", bash: /prereq(?: missing \(install manually\))?: node\b/ }, { id: "prereqs.claude", bash: /prereq(?: missing \(install manually\))?: claude\b/ },
  { id: "claude-config.checkout", bash: /~\/\.claude is (?:a|not a) git checkout/ }, { id: "claude-config.clean", bash: /~\/\.claude (?:clean vs origin|has \d+ changed path)/ },
  { id: "claude-config.settings-valid", bash: /settings\.json (?:is valid JSON|missing or invalid)/ }, { id: "claude-config.hooks-match", bash: /hooks (?:match canonical|block differs)/ },
  { id: "claude-config.template-keys", bash: /(?:carries every template key|settings template drift)/ }, { id: "secrets.mecp-api-key", bash: /(?:MeCP API key present|no MeCP API key)/ },
  { id: "project-memory.repo", bash: /claude-memory-sync repo (?:present|missing)/ },
  { id: "project-memory.device-config", bash: /(?:device config exists: devices\/|no device config for)/ },
  { id: "project-memory.resolves", bash: /sync-memory list (?:resolves|failed)/ },
  { id: "project-memory.coverage", bash: /(?:memory dir\(s\) on this device are mapped|memory dirs are NOT synced|maps NOTHING but memory dirs exist)/ },
  { id: "mct.status", bash: /(?:no me-count-token checkout|mct checkout present but dist\/ not built|mct built but not activated|mct activated but node|mct doctor (?:passes|reports problems))/ },
];
const ICONS: Record<string, Status> = { "✓": "ok", "!": "warn", "✗": "error" };

export function parseBashDoctor(text: string): Record<string, Status> {
  const out: Record<string, Status> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const m = /^\s*([✓!✗])\s+(.*)$/.exec(line);
    if (!m) continue;
    for (const p of PARITY_MAP) if (p.bash.test(m[2]) && !(p.id in out)) out[p.id] = ICONS[m[1]];
  }
  return out;
}
