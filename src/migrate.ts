import path from "node:path";
import { CHECKLIST_MARKER, firstPartyStore, legacyFacts, renderChecklist } from "./artifacts/legacy-subscription.ts";
import type { Ctx } from "./engine/artifact.ts";
import { scanForSecrets } from "./engine/capture.ts";
import { pj } from "./engine/env.ts";
import { gateLines, managedGate, refusesManaged } from "./engine/managed-gate.ts";
import { resolveHomePath } from "./engine/paths.ts";
import type { Profile } from "./engine/profile.ts";
import type { Sink } from "./ui/headless.ts";

export const EXIT_MANAGED = 4;

/** True when `p` is the store folder or anywhere beneath it (lexical, target-os flavour; case-insensitive on macOS and Windows). */
function insideStore(os: Ctx["env"]["os"], p: string, store: string): boolean {
  const flavour = os === "win32" ? path.win32 : path.posix;
  const fold = (x: string) => (os === "linux" ? x : x.toLowerCase());
  const rel = flavour.relative(fold(flavour.resolve(store)), fold(flavour.resolve(p)));
  const up = rel === ".." || rel.startsWith(`..${flavour.sep}`); // "..x" is a child named ..x, not a parent hop
  return rel === "" || (!up && !flavour.isAbsolute(rel));
}

/**
 * Win32 path normalization drops a trailing period from every segment and trailing periods and spaces from the last one, so
 * `Claude.`, `Claude.\x` and `Claude ` all name `Claude`. Folded here for every segment (the over-fold can only refuse a
 * look-alike, never admit the store). A segment that is nothing but dots stays: `.`/`..` resolve later, and `...` is a real name.
 */
function foldWin32TrailingDotsAndSpaces(p: string): string {
  return p.split(/[\\/]/).map((seg) => {
    const trimmed = seg.replace(/ +$/, "");
    return /^\.*$/.test(trimmed) ? trimmed : trimmed.replace(/[. ]+$/, "");
  }).join("\\");
}

/**
 * An IPv4 host in any spelling `inet_aton` (and so Windows' name resolver) accepts: one to four dot-separated parts, each decimal,
 * octal (leading 0) or hex (0x), the last part filling the remaining bytes (`127.1` = 127.0.0.1, `2130706433` = 127.0.0.1).
 * Returns the 32-bit address, or null when `h` is not such a literal.
 */
function parseInetAton(h: string): number | null {
  const parts = h.split(".");
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (/^0x[0-9a-f]+$/i.test(part)) nums.push(parseInt(part.slice(2), 16));
    else if (/^0[0-7]*$/.test(part)) nums.push(parseInt(part, 8));
    else if (/^[1-9][0-9]*$/.test(part)) nums.push(parseInt(part, 10));
    else return null;
  }
  const last = nums.pop()!;
  if (nums.some((n) => n > 255)) return null;
  const lastBytes = 4 - nums.length;
  if (last >= 2 ** (8 * lastBytes)) return null;
  return nums.reduce((v, n) => v * 256 + n, 0) * 2 ** (8 * lastBytes) + last;
}

/** The eight 16-bit groups of an IPv6 literal (`::` compression and a trailing dotted IPv4 allowed), or null. */
function parseIPv6(h: string): number[] | null {
  let s = h;
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  let tailGroups: number[] = [];
  if (v4) {
    const parts = v4[2]!.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    tailGroups = [parts[0]! * 256 + parts[1]!, parts[2]! * 256 + parts[3]!];
    s = v4[1]!.endsWith("::") ? v4[1]! : v4[1]!.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (x: string) => (x === "" ? [] : x.split(":"));
  const head = groups(halves[0]!), rest = halves.length === 2 ? groups(halves[1]!) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = head.length + rest.length + tailGroups.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const fill = Array<number>(8 - known).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...fill, ...rest.map((g) => parseInt(g, 16)), ...tailGroups];
}

/**
 * True when `host` (a UNC server name) is an address of the local machine: any 127.0.0.0/8 spelling, `::1`, an IPv4-mapped or
 * -compatible loopback (`::ffff:127.0.0.1`, `::127.0.0.1`), in bare, `[bracketed]` or `ipv6-literal.net` form (`--1.ipv6-literal.net`,
 * colons as dashes, `s` before a zone id).
 */
function isLoopbackHost(host: string): boolean {
  const v4 = parseInetAton(host);
  if (v4 !== null) return Math.floor(v4 / 2 ** 24) === 127;
  const literal = /^(.*)\.ipv6-literal\.net$/i.exec(host);
  const bare = literal ? literal[1]!.replace(/s.*$/i, "").replace(/-/g, ":") : host.replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  const g = parseIPv6(bare);
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;   // ::1
  const embedded127 = g[6]! >> 8 === 0x7f;
  return g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0) && embedded127;   // ::ffff:127.x / ::127.x
}

/**
 * The local machine's own names, matched lexically (no DNS: the guard stays synchronous and deterministic): `localhost` and this
 * machine's short host name, each alone or with any domain suffix (`box.corp.example.edu`, the FQDN). Over-matching a same-named
 * host in another domain can only refuse a look-alike path, never admit the store. Names that reach this machine only through
 * DNS or a hosts-file alias are not recognised.
 */
function isOwnHostName(host: string, ownHostname: string): boolean {
  const first = host.split(".")[0]!;
  const own = ownHostname.toLowerCase().split(".")[0]!;
  return first === "localhost" || (own !== "" && first === own);
}

/**
 * `\\localhost\C$\x`, `\\127.0.0.1\C$\x` and `\\<this machine>\C$\x` are the local `C:\x` reached through the administrative
 * share; so is every other loopback address and own-name spelling (see `isLoopbackHost` / `isOwnHostName`). Maps them back to the
 * drive path; any other host (or a non-drive share such as `ADMIN$`) is left as the UNC path it is.
 */
function mapLoopbackAdminShare(ctx: Ctx, p: string): string {
  const m = /^[\\/]{2}([^\\/]+)[\\/]([a-z])\$(?:[\\/](.*))?$/is.exec(p);
  if (!m) return p;
  const host = m[1]!.replace(/\.+$/, "").toLowerCase();
  const local = isLoopbackHost(host) || isOwnHostName(host, ctx.io.hostname);
  return local ? `${m[2]!.toUpperCase()}:\\${m[3] ?? ""}` : p;
}

/** The NTFS stream suffixes that name a directory's own index, i.e. the directory itself: `::$INDEX_ALLOCATION`, `:$I30`, `:$I30:$INDEX_ALLOCATION`. */
const NTFS_DIRECTORY_STREAM = /^(?::\$i30(?::\$index_allocation)?|::\$index_allocation)$/i;

/**
 * Folds the NTFS directory-stream suffixes off every segment (`Claude::$INDEX_ALLOCATION` names the folder `Claude`). Returns null
 * for any other stream syntax (`x:name`, `x::$DATA`): a folder path never names a data stream, so `--out` refuses it rather than
 * guess. The drive prefix and a UNC path's server and share segments (an IPv6 server name has colons) are left alone.
 */
function foldNtfsDirectoryStreams(p: string): string | null {
  const segs = p.split(/[\\/]/);
  const first = /^[\\/]{2}/.test(p) ? 4 : /^[a-z]:$/i.test(segs[0] ?? "") ? 1 : 0;
  for (let i = first; i < segs.length; i++) {
    const at = segs[i]!.indexOf(":");
    if (at === -1) continue;
    if (!NTFS_DIRECTORY_STREAM.test(segs[i]!.slice(at))) return null;
    segs[i] = segs[i]!.slice(0, at);
  }
  return segs.join("\\");
}

/**
 * Windows `\\?\` (long-path) and `\\.\` (device) namespace prefixes name the same file as the plain path, so the lexical store
 * check must look through them: `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\share` → `\\srv\share` (either separator style).
 * Returns null for a namespace path that is neither a drive path nor a UNC share (`\\?\Volume{…}\`, `\\.\PhysicalDrive0`, bare
 * `\\?\C:`), which no lexical check can place relative to the store.
 */
function stripWin32NamespacePrefix(p: string): string | null {
  const ns = /^[\\/]{2}[?.][\\/](.*)$/s.exec(p);
  if (!ns) return p;
  const rest = ns[1]!;
  const unc = /^unc[\\/](.*)$/is.exec(rest);
  if (unc) return `\\\\${unc[1]}`;
  return /^[a-z]:[\\/]/i.test(rest) ? rest : null;
}

/**
 * A Windows path that is resolved against a per-process current folder: `C:foo` / `C:` (relative to drive C:'s current folder) or
 * `\foo` (rooted on whatever drive is current). Neither can be checked against the store lexically, so `--out` refuses both.
 */
function win32CurrentDriveRelativeError(out: string): string | null {
  if (/^[a-z]:(?![\\/])/i.test(out)) return `--out ${out} is drive-relative (it depends on the current folder of drive ${out.slice(0, 2)}); give a full path such as ${out.slice(0, 2)}\\Users\\you\\Documents\\claude-migration, or a ~ path`;
  if (/^[\\/](?![\\/])/.test(out)) return `--out ${out} has no drive letter (it depends on the current drive); give a full path such as C:\\Users\\you\\Documents\\claude-migration, or a ~ path`;
  return null;
}

/**
 * The path as the filesystem will see it, for the lexical store comparison: namespace prefix, loopback admin share, NTFS
 * directory-stream suffixes and trailing dots/spaces folded away (Windows only). Says why when the path cannot be placed.
 */
function win32Canonical(ctx: Ctx, p: string): { path: string } | { unplaceable: "namespace" | "stream" } {
  const plain = stripWin32NamespacePrefix(p);
  if (plain === null) return { unplaceable: "namespace" };
  const unstreamed = foldNtfsDirectoryStreams(mapLoopbackAdminShare(ctx, plain));
  if (unstreamed === null) return { unplaceable: "stream" };
  return { path: foldWin32TrailingDotsAndSpaces(unstreamed) };
}

/** A path the OS handed back (a realpath or a link target), canonicalised for comparison when it can be, else as given. */
const canonicalOr = (ctx: Ctx, p: string) => {
  if (ctx.env.os !== "win32") return p;
  const c = win32Canonical(ctx, p);
  return "path" in c ? c.path : p;
};

/** More link hops than any OS follows (Linux MAXSYMLINKS is 40, Windows stops at 63), so a chain the OS can walk is walked here too. */
const MAX_LINK_HOPS = 64;

/**
 * `p` with the nearest EXISTING ancestor replaced by its real location (links, junctions, `subst` drives, 8.3 names resolved by
 * the OS), the not-yet-created tail re-attached. A dangling link on the way (one whose target does not exist yet) is followed
 * through `readlink` — relative targets against the link's folder — and the walk continues from its target, because creating the
 * folder would create it there. A path nothing of which exists comes back as given; so does a link cycle (nothing can be created
 * through one).
 */
async function realLocation(ctx: Ctx, p: string): Promise<string> {
  const flavour = ctx.env.os === "win32" ? path.win32 : path.posix;
  let cur = p;
  let tail: string[] = [];
  for (let hops = 0; hops < MAX_LINK_HOPS;) {
    const real = await ctx.io.realpath(cur);
    if (real !== null) return flavour.join(real, ...tail);
    if ((await ctx.io.lstat(cur))?.isSymbolicLink) {
      const target = await ctx.io.readlink(cur);
      if (target !== null) {
        hops++;
        cur = flavour.join(canonicalOr(ctx, flavour.resolve(flavour.dirname(cur), target)), ...tail);
        tail = [];
        continue;
      }
    }
    const parent = flavour.dirname(cur);
    if (parent === cur) return flavour.join(cur, ...tail);
    tail.unshift(flavour.basename(cur));
    cur = parent;
  }
  return p;
}

/**
 * The one `--out` resolver, shared by `bs migrate` and `bs capture`: expands `~` / home-relative forms against the target home,
 * then refuses any folder inside the first-party Claude store. On Windows it first refuses drive-relative forms, then compares by
 * the spelling the filesystem will resolve: namespace prefixes (`\\?\`, `\\.\`), loopback admin shares and trailing dots/spaces
 * are folded away. On every OS it also resolves the nearest existing ancestor through the Io (symlinks, junctions, `subst`, 8.3
 * names, and a dangling link through its target) and refuses a folder that really lives in the store, or in the real folder the
 * store itself is a link to. On Windows any loopback address or own-name spelling of an admin share is local, an NTFS
 * directory-stream suffix is folded, and any other stream syntax is refused. The folder returned keeps the spelling the user gave.
 * Returns the folder, or the refusal text and exit code to emit.
 * Not covered: a host name that reaches this machine only through DNS or a hosts-file alias (the own-name rule is lexical).
 */
export async function resolveOutDir(ctx: Ctx, out: string): Promise<{ dir: string } | { error: string; code: number }> {
  const win = ctx.env.os === "win32";
  const driveRelative = win ? win32CurrentDriveRelativeError(out) : null;
  if (driveRelative) return { error: driveRelative, code: 2 };
  let dir: string;
  try { dir = resolveHomePath(ctx.env.os, ctx.env.home, out); }
  catch (e) { return { error: `--out: ${(e as Error).message}`, code: 2 }; }
  const canon = win ? win32Canonical(ctx, dir) : { path: dir };
  if ("unplaceable" in canon) {
    return canon.unplaceable === "namespace"
      ? { error: `--out ${dir} is a \\\\?\\ or \\\\.\\ path that does not continue with a drive letter or a UNC share (C:\\… or UNC\\server\\share); give a full path`, code: 2 }
      : { error: `--out ${dir} names an NTFS alternate data stream (a colon after the drive letter); give a plain folder path`, code: 2 };
  }
  const comparable = canon.path;
  const store = firstPartyStore(ctx);
  const refusal = (via: string) => ({ error: `refusing --out ${dir}: it is inside Claude's own data folder (${store})${via}. Choose another folder.`, code: 2 });
  if (insideStore(ctx.env.os, comparable, store)) return refusal("");
  const realStore = canonicalOr(ctx, await realLocation(ctx, store));
  const realOut = canonicalOr(ctx, await realLocation(ctx, comparable));
  if (insideStore(ctx.env.os, realOut, store) || insideStore(ctx.env.os, realOut, realStore)) return refusal(` — it resolves to ${realOut}`);
  return { dir };
}

/**
 * `bs migrate` (spec 2026-09-30 section 4). B1 ships the checklist half only: it reads the machine and writes ONE file, instructions.md,
 * inside the output folder it owns. Nothing is applied and nothing under the first-party Claude store is touched. On a managed
 * (or managed-unknown) box the checklist is still written, with the managed notice, because it is read-only and still useful; the
 * full flow refuses there. There is no override flag.
 */
export async function runMigrate(o: { ctx: Ctx; profile: Profile; checklistOnly: boolean; out?: string; stdout: Sink; stderr: Sink }): Promise<number> {
  const { ctx, profile, stdout, stderr } = o;
  if (!profile.artifacts.some((a) => a.id === "legacy-subscription")) { stderr.write("bs migrate needs --profile cornell-faculty (a profile with the legacy-subscription artifact)"); return 2; }
  const gate = refusesManaged(profile) ? await managedGate(ctx.io, ctx.env.os) : { verdict: "clean" as const, message: null, detail: null };
  if (gate.verdict !== "clean" && !o.checklistOnly) {
    for (const l of gateLines(gate)) stderr.write(l);
    stderr.write("Nothing was changed. You can still run: bs migrate --checklist-only");
    return EXIT_MANAGED;
  }
  if (!o.checklistOnly) {
    stderr.write("The full migrate flow (checklist, pause, then onboard) is not built yet. Run bs migrate --checklist-only to write your save-this-first checklist.");
    return 2;
  }
  const hosted = (profile.options["hosted-connectors"] ?? {}) as { connectors?: string[]; features?: string[] };
  const md = renderChecklist(await legacyFacts(ctx), hosted);
  const hits = scanForSecrets([{ path: "instructions.md", content: md }]);
  if (hits.length) { stderr.write(`refusing to write the checklist: ${hits.length} secret-shaped string(s) (${hits.map((h) => `line ${h.line}, ${h.pattern}`).join("; ")})`); return 1; }
  const resolved = await resolveOutDir(ctx, o.out ?? pj(ctx.env.os, ctx.env.home, "Documents", "claude-migration"));
  if ("error" in resolved) { stderr.write(resolved.error); return resolved.code; }
  const dir = resolved.dir;
  const target = pj(ctx.env.os, dir, "instructions.md");
  const existing = await ctx.io.readFile(target);
  if (existing !== null && !existing.startsWith(CHECKLIST_MARKER)) { stderr.write(`${target} already exists and was not written by this tool, so it was left alone. Choose another folder with --out.`); return 1; }
  if (gate.verdict !== "clean") for (const l of gateLines(gate)) stdout.write(l);
  await ctx.io.writeFile(target, md);
  stdout.write(`==> checklist written: ${target}`);
  stdout.write("Your claude.ai account is untouched. Work through the list, and cancel your personal subscription only after you have saved what you need.");
  return 0;
}
