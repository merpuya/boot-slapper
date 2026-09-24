import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * "Is this module the process entry point?" for an ESM CLI.
 *
 * Node resolves symlinks when loading ESM, so `import.meta.url` is the *real* path of dist/cli.js
 * while `process.argv[1]` is whatever was invoked — for a global bin (`npm link`, `npm i -g`) that is
 * the `/opt/homebrew/bin/bs` symlink. Comparing the raw argv alone therefore never matches, `main()`
 * never runs, and `bs doctor` prints nothing and exits 0. Resolve argv[1] before comparing.
 */
export function isMainModule(
  argv1: string | undefined,
  moduleUrl: string,
  realpath: (p: string) => string = (p) => realpathSync(p),
): boolean {
  if (!argv1) return false;
  if (pathToFileURL(argv1).href === moduleUrl) return true;
  let resolved: string | null = null;
  try { resolved = realpath(argv1); } catch { resolved = null; }
  if (resolved !== null && pathToFileURL(resolved).href === moduleUrl) return true;
  return argv1.endsWith("/dist/cli.js") || argv1.endsWith("\\dist\\cli.js");
}
