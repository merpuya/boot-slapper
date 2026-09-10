import { pj, type Os } from "./env.ts";
import type { Io } from "./io.ts";

/** Every file under `root`, as sorted posix-relative paths. Skips `.git`. A missing root yields []. */
export async function walkFiles(io: Io, os: Os, root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, rel: string): Promise<void> {
    for (const name of (await io.readdir(dir)).sort()) {
      if (name === ".git") continue;
      const p = pj(os, dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (await io.isDir(p)) await rec(p, r); else out.push(r);
    }
  }
  if (await io.isDir(root)) await rec(root, "");
  return out;
}
