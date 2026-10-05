import type { Profile } from "./profile.ts";

/** Env var that overrides the profile's gateway URL at run time (same plain-uppercase style as DEVICE_LABEL). The `--gateway-url` flag beats it. */
export const GATEWAY_URL_ENV = "CORNELL_GATEWAY_URL";

/** RFC 2606 `.invalid` placeholder host, with or without the trailing root dot. */
const INVALID_HOST = /\.invalid\.?$/i;

const originOf = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null; } catch { return null; }
};

/** Every string value in `v` that parses as an http(s) URL, at any depth. */
function urlsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") { if (originOf(v)) out.push(v); }
  else if (Array.isArray(v)) for (const x of v) urlsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) urlsIn(x, out);
  return out;
}

/** Every URL anywhere in `profile.options` whose hostname is still an `.invalid` placeholder (trailing-dot form included). Applying one would write a dead endpoint. */
export function placeholderUrls(profile: Profile): string[] {
  return urlsIn(profile.options).filter((u) => { try { return INVALID_HOST.test(new URL(u).hostname); } catch { return false; } });
}

/** Rewrites the profile's gateway origin (the desktop-inference baseUrl) to `override` everywhere it appears in options, keeping paths. The profile file stays value-free. Returns the input unchanged when it has no gateway URL, or when no URL in it is a `.invalid` placeholder (a profile with real URLs, like aca34, is never re-pointed by a stray env var). */
export function applyGatewayOverride(profile: Profile, override: string): Profile {
  const next = originOf(override);
  if (!next) throw new Error(`gateway URL override is not an http(s) URL: ${override}`);
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
