import path from "node:path";
import { pj, type Os } from "./env.ts";

/**
 * Resolve a profile-supplied folder against the user's home, for the TARGET os (tests simulate win32 on a mac host).
 * `~`, `~/x` and `~\x` expand; an absolute path is returned untouched; any other path is taken as home-relative.
 * A home-relative form may not contain `..` (it would climb out of the home it names), and `~user` is not supported.
 */
export function resolveHomePath(os: Os, home: string, p: string): string {
  if (!p.trim()) throw new Error("home-relative path is empty");
  const abs = (os === "win32" ? path.win32 : path.posix).isAbsolute(p);
  if (abs) return p;
  let rest = p;
  if (p === "~") rest = "";
  else if (p.startsWith("~/") || p.startsWith("~\\")) rest = p.slice(2);
  else if (p.startsWith("~")) throw new Error(`~user paths are not supported: ${p}`);
  const segs = rest.split(/[\\/]+/).filter((s) => s.length > 0 && s !== ".");
  if (segs.includes("..")) throw new Error(`a home-relative path may not contain '..': ${p}`);
  return pj(os, home, ...segs);
}
