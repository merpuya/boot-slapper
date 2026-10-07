import type { Profile } from "./profile.ts";

/** Env var that overrides the profile's gateway URL at run time (same plain-uppercase style as DEVICE_LABEL); the `--gateway-url <url>` flag beats it. Either way the value is an https origin only. */
export const GATEWAY_URL_ENV = "CORNELL_GATEWAY_URL";

/** RFC 2606 `.invalid` placeholder host, with or without trailing root dots (`.invalid.`, and the malformed `.invalid..`). */
const INVALID_HOST = /\.invalid\.*$/i;

const originOf = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null; } catch { return null; }
};

/** A bare or protocol-relative host (no scheme) that is a `.invalid` placeholder, optionally with trailing dots, a port, path, query or fragment: `gateway.invalid`, `//gw.invalid/`, `gw.invalid?x`, `gw.example.invalid.:8443`, `gw.invalid..`. */
const BARE_INVALID = /^(\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.invalid\.*(:\d+)?([/?#].*)?$/i;

/**
 * Leading/trailing whitespace is trimmed first, so a padded value (` gw.invalid `) is judged by what it names.
 * Accepted, deliberately not flagged (N9 = B; profile strings are author-controlled and none of these is a regression):
 * a bare triple-slash (`///gw.invalid/`), a bare backslash (`\\gw.invalid`), a trailing semicolon (`gw.invalid;`,
 * `https://gw.invalid;/`) and bare userinfo (`user@gw.invalid`). The scheme'd triple-slash, backslash and userinfo
 * forms already resolve to the `.invalid` host through WHATWG URL parsing and are flagged.
 */
const isPlaceholder = (raw: string): boolean => {
  const s = raw.trim();
  if (BARE_INVALID.test(s)) return true;
  try { return INVALID_HOST.test(new URL(s).hostname); } catch { return false; }
};

function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

/** Every string anywhere in `profile.options` that points at an `.invalid` placeholder host, whatever the scheme (https, http, wss, ws, ...) or whether it is a bare host with no scheme at all. A trailing-dot host (one dot or more) and a whitespace-padded value count. Applying one would write a dead endpoint, so the onboard guard refuses on any hit. */
export function placeholderUrls(profile: Profile): string[] {
  return stringsIn(profile.options).filter(isPlaceholder);
}

/** Validates a run-time override and returns its origin. https only (plain http would send the gateway key in clear), and the origin alone: a path, query, fragment or credentials would be silently dropped or double-applied by the path-keeping rewrite below, so they are refused rather than guessed at (N19). */
function overrideOrigin(override: string): string {
  let u: URL;
  try { u = new URL(override); } catch { throw new Error(`gateway URL override is not an http(s) URL: ${override}`); }
  if (u.protocol === "http:") throw new Error(`gateway URL override must use https, not plain http (the gateway key would travel in clear): ${override}`);
  if (u.protocol !== "https:") throw new Error(`gateway URL override is not an http(s) URL: ${override}`);
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash || u.username || u.password) {
    throw new Error(`gateway URL override must be an https origin only (scheme://host[:port], no path, query, fragment or credentials; the profile supplies paths like /mcp/): ${override}`);
  }
  return u.origin;
}

/** Rewrites the profile's gateway origin (the desktop-inference baseUrl) to `override` everywhere it appears in options, keeping paths. The profile file stays value-free. Returns the input unchanged when it has no gateway URL, or when no URL in it is a `.invalid` placeholder (a profile with real URLs, like aca34, is never re-pointed by a stray env var). The override is validated first, so a malformed stray env var (plain http, or carrying a path) is refused for every profile, aca34 included, and makes every command (`secrets set` included: this runs before the command switch) exit 2 by design: loud beats a silent no-op. */
export function applyGatewayOverride(profile: Profile, override: string): Profile {
  const next = overrideOrigin(override);
  const from = originOf((profile.options["desktop-inference"] as { baseUrl?: unknown } | undefined)?.baseUrl);
  if (!from || placeholderUrls(profile).length === 0) return profile;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v === from || v.startsWith(from + "/") ? next + v.slice(from.length) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { ...profile, options: walk(profile.options) as Profile["options"] };
}
