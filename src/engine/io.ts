import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs, realpath as realpathCb } from "node:fs";
import { homedir, hostname, platform as osPlatform } from "node:os";
import path from "node:path";

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface ExecOpts { stdin?: string; cwd?: string; env?: Record<string, string>; timeout?: number }

export interface FetchInit { method?: "GET"; headers?: Record<string, string>; timeout?: number }
export interface FetchResult { status: number; body: string }

export interface Io {
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly hostname: string;
  readFile(p: string): Promise<string | null>;
  writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void>;
  appendFile(p: string, s: string, opts?: { mode?: number }): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  isDir(p: string): Promise<boolean>;
  /**
   * The canonical on-disk spelling of an EXISTING path: symlinks, junctions, `subst` drives and 8.3 short names resolved. Null when
   * the path does not exist (or cannot be read), so callers walk up to the nearest ancestor that does.
   */
  realpath(p: string): Promise<string | null>;
  /**
   * Whether `p` is itself a link (symlink or junction), WITHOUT following it; the folders above it are followed. Null when nothing
   * is there at all. A dangling link (its target missing) is still `{ isSymbolicLink: true }`, which `realpath` cannot report.
   */
  lstat(p: string): Promise<{ isSymbolicLink: boolean } | null>;
  /** The target a link stores, as written (it may be relative to the link's folder). Null when `p` is not a link. */
  readlink(p: string): Promise<string | null>;
  mkdirp(p: string, opts?: { mode?: number }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  which(cmd: string): Promise<string | null>;
  fetch(url: string, init?: FetchInit): Promise<FetchResult>;
  /** Kill any child process an `exec` is still waiting on. Ink swallows SIGINT in raw mode, so the TUI calls this on Ctrl+C. */
  killLive?(): void;
}

export class RealIo implements Io {
  readonly env = process.env;
  readonly platform = osPlatform();
  readonly home = homedir();
  readonly hostname = hostname();
  private live = new Set<ChildProcess>();
  private killed = false;

  killLive(): void {
    this.killed = true;   // the run is being torn down: a step still unwinding must not start the next child
    for (const child of this.live) {
      // A process tree on Windows (npm → node → …) survives a plain kill of its root.
      if (this.platform === "win32" && child.pid !== undefined) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    }
    this.live.clear();
  }

  async readFile(p: string): Promise<string | null> {
    try { return await fs.readFile(p, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, s, { encoding: "utf8", mode: opts?.mode });
    if (opts?.mode !== undefined) await fs.chmod(p, opts.mode);
  }
  async appendFile(p: string, s: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, s, { encoding: "utf8", mode: opts?.mode });
  }
  async copyFile(src: string, dst: string): Promise<void> { await fs.copyFile(src, dst); }
  async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }
  async isDir(p: string): Promise<boolean> {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  }
  async realpath(p: string): Promise<string | null> {
    // .native asks the OS (GetFinalPathNameByHandle on Windows), which expands 8.3 names and junctions; the JS walker does not.
    return new Promise((resolve) => realpathCb.native(p, (err, rp) => resolve(err ? null : rp)));
  }
  async lstat(p: string): Promise<{ isSymbolicLink: boolean } | null> {
    // On Windows a junction reports isSymbolicLink() too (libuv maps IO_REPARSE_TAG_MOUNT_POINT to a link).
    try { return { isSymbolicLink: (await fs.lstat(p)).isSymbolicLink() }; } catch { return null; }
  }
  async readlink(p: string): Promise<string | null> {
    try { return await fs.readlink(p); } catch { return null; }
  }
  async mkdirp(p: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(p, { recursive: true, mode: opts?.mode });
  }
  async readdir(p: string): Promise<string[]> {
    try { return await fs.readdir(p); } catch { return []; }
  }
  exec(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      if (this.killed) { resolve({ code: 130, stdout: "", stderr: "[interrupted]" }); return; }
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.live.add(child);
      let stdout = "", stderr = "";
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      if (opts.timeout !== undefined) {
        timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeout);
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.on("error", () => {});
      child.on("error", (e) => { this.live.delete(child); if (timer) clearTimeout(timer); resolve({ code: 127, stdout, stderr: stderr + String(e) }); });
      child.on("close", (code) => {
        this.live.delete(child);
        if (timer) clearTimeout(timer);
        if (timedOut) { resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" }); return; }
        resolve({ code: code ?? 1, stdout, stderr });
      });
      if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
      child.stdin.end();
    });
  }
  async which(cmd: string): Promise<string | null> {
    const finder = this.platform === "win32" ? "where" : "which";
    const r = await this.exec(finder, [cmd]);
    if (r.code !== 0) return null;
    const first = r.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
    return first ? first.trim() : null;
  }
  async fetch(url: string, init: FetchInit = {}): Promise<FetchResult> {
    try {
      const r = await globalThis.fetch(url, { method: init.method ?? "GET", headers: init.headers, signal: AbortSignal.timeout(init.timeout ?? 15_000), redirect: "manual" });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: 0, body: e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : String(e) };
    }
  }
}

export interface ExecCall { cmd: string; args: string[]; opts: ExecOpts }
type Handler = (call: ExecCall) => ExecResult | Promise<ExecResult>;

export class FakeIo implements Io {
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly hostname: string;
  files: Map<string, string>;
  dirs: Set<string>;
  modes = new Map<string, number>();
  /** Symlinks, junctions and `subst` drives: link path → the path it points at. Only `realpath` follows them. */
  links = new Map<string, string>();
  calls: ExecCall[] = [];
  writes: string[] = [];
  fetches: Array<{ url: string; init: FetchInit }> = [];
  private handlers: Array<{ match: (cmd: string, args: string[]) => boolean; handler: Handler }> = [];
  private fetchHandlers: Array<{ match: (url: string) => boolean; handler: (url: string, init: FetchInit) => FetchResult }> = [];
  private pathMap: Record<string, string>;

  constructor(init: {
    platform?: NodeJS.Platform; home?: string; hostname?: string;
    env?: Record<string, string | undefined>; files?: Record<string, string>;
    dirs?: string[]; path?: Record<string, string>; links?: Record<string, string>;
  } = {}) {
    this.platform = init.platform ?? "darwin";
    this.home = init.home ?? "/h";
    this.hostname = init.hostname ?? "testbox";
    this.env = init.env ?? {};
    this.files = new Map(Object.entries(init.files ?? {}));
    this.dirs = new Set(init.dirs ?? []);
    for (const f of this.files.keys()) this.addParents(f);
    for (const d of [...this.dirs]) this.addParents(d);
    this.pathMap = init.path ?? {};
    this.links = new Map(Object.entries(init.links ?? {}));
  }
  /** Path flavour of the simulated machine: a win32 fake has backslash paths that posix dirname cannot split. */
  private get pp() { return this.platform === "win32" ? path.win32 : path.posix; }
  private addParents(p: string) {
    const pp = this.pp;
    let d = pp.dirname(p);
    while (d && d !== "/" && d !== "." && d !== pp.dirname(d)) { this.dirs.add(d); d = pp.dirname(d); }
  }
  on(match: (cmd: string, args: string[]) => boolean, handler: Handler) { this.handlers.push({ match, handler }); }
  onFetch(match: (url: string) => boolean, handler: (url: string, init: FetchInit) => FetchResult) { this.fetchHandlers.push({ match, handler }); }

  async readFile(p: string) { return this.files.get(p) ?? null; }
  async writeFile(p: string, s: string, opts?: { mode?: number }) {
    this.files.set(p, s); this.addParents(p); this.writes.push(p);
    if (opts?.mode !== undefined) this.modes.set(p, opts.mode);
  }
  async appendFile(p: string, s: string, opts?: { mode?: number }) {
    await this.writeFile(p, (this.files.get(p) ?? "") + s, opts);
  }
  async copyFile(src: string, dst: string) {
    const s = this.files.get(src); if (s === undefined) throw new Error(`ENOENT ${src}`);
    await this.writeFile(dst, s);
  }
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async isDir(p: string) { return this.dirs.has(p); }
  async realpath(p: string) {
    const pp = this.pp;
    const fold = (x: string) => (this.platform === "linux" ? x : x.toLowerCase());
    let cur = p;
    for (let hop = 0; hop < 40; hop++) {
      const hit = [...this.links].find(([l]) => fold(cur) === fold(l) || fold(cur).startsWith(fold(l) + pp.sep));
      if (!hit) return (await this.exists(cur)) ? cur : null;
      cur = hit[1] + cur.slice(hit[0].length);
    }
    return null;   // a link cycle: ELOOP
  }
  /** The `links` key `p` names: either spelled as given, or with the folders above it resolved (as the OS resolves them). */
  private async linkAt(p: string): Promise<[string, string] | undefined> {
    const pp = this.pp;
    const fold = (x: string) => (this.platform === "linux" ? x : x.toLowerCase());
    const parent = await this.realpath(pp.dirname(p));
    const spellings = [p, ...(parent === null ? [] : [pp.join(parent, pp.basename(p))])].map(fold);
    return [...this.links].find(([l]) => spellings.includes(fold(l)));
  }
  async lstat(p: string) {
    if (await this.linkAt(p)) return { isSymbolicLink: true };
    return (await this.realpath(p)) !== null ? { isSymbolicLink: false } : null;
  }
  async readlink(p: string) { return (await this.linkAt(p))?.[1] ?? null; }
  async mkdirp(p: string) { this.dirs.add(p); this.addParents(p + this.pp.sep + "x"); }
  async readdir(p: string) {
    if (!this.dirs.has(p)) return [];
    const out = new Set<string>();
    const pp = this.pp;
    for (const f of this.files.keys()) if (pp.dirname(f) === p) out.add(pp.basename(f));
    for (const d of this.dirs) if (pp.dirname(d) === p) out.add(pp.basename(d));
    return [...out];
  }
  async exec(cmd: string, args: string[], opts: ExecOpts = {}) {
    const call = { cmd, args, opts }; this.calls.push(call);
    for (const h of this.handlers) if (h.match(cmd, args)) return h.handler(call);
    return { code: 127, stdout: "", stderr: `${cmd}: not handled` };
  }
  async which(cmd: string) { return this.pathMap[cmd] ?? null; }
  async fetch(url: string, init: FetchInit = {}): Promise<FetchResult> {
    this.fetches.push({ url, init });
    for (const h of this.fetchHandlers) if (h.match(url)) return h.handler(url, init);
    return { status: 0, body: "fetch not handled" };
  }
}
