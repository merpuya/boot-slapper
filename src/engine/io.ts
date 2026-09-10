import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, hostname, platform as osPlatform } from "node:os";
import path from "node:path";

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface ExecOpts { stdin?: string; cwd?: string; env?: Record<string, string> }

export interface Io {
  readonly env: Record<string, string | undefined>;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly hostname: string;
  readFile(p: string): Promise<string | null>;
  writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  isDir(p: string): Promise<boolean>;
  mkdirp(p: string, opts?: { mode?: number }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  which(cmd: string): Promise<string | null>;
}

export class RealIo implements Io {
  readonly env = process.env;
  readonly platform = osPlatform();
  readonly home = homedir();
  readonly hostname = hostname();

  async readFile(p: string): Promise<string | null> {
    try { return await fs.readFile(p, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async writeFile(p: string, s: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, s, { encoding: "utf8", mode: opts?.mode });
    if (opts?.mode !== undefined) await fs.chmod(p, opts.mode);
  }
  async copyFile(src: string, dst: string): Promise<void> { await fs.copyFile(src, dst); }
  async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }
  async isDir(p: string): Promise<boolean> {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  }
  async mkdirp(p: string, opts?: { mode?: number }): Promise<void> {
    await fs.mkdir(p, { recursive: true, mode: opts?.mode });
  }
  async readdir(p: string): Promise<string[]> {
    try { return await fs.readdir(p); } catch { return []; }
  }
  exec(cmd: string, args: string[], opts: ExecOpts = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + String(e) }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
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
  calls: ExecCall[] = [];
  writes: string[] = [];
  private handlers: Array<{ match: (cmd: string, args: string[]) => boolean; handler: Handler }> = [];
  private pathMap: Record<string, string>;

  constructor(init: {
    platform?: NodeJS.Platform; home?: string; hostname?: string;
    env?: Record<string, string | undefined>; files?: Record<string, string>;
    dirs?: string[]; path?: Record<string, string>;
  } = {}) {
    this.platform = init.platform ?? "darwin";
    this.home = init.home ?? "/h";
    this.hostname = init.hostname ?? "testbox";
    this.env = init.env ?? {};
    this.files = new Map(Object.entries(init.files ?? {}));
    this.dirs = new Set(init.dirs ?? []);
    for (const f of this.files.keys()) this.addParents(f);
    this.pathMap = init.path ?? {};
  }
  private addParents(p: string) {
    let d = path.posix.dirname(p);
    while (d && d !== "/" && d !== ".") { this.dirs.add(d); d = path.posix.dirname(d); }
  }
  on(match: (cmd: string, args: string[]) => boolean, handler: Handler) { this.handlers.push({ match, handler }); }

  async readFile(p: string) { return this.files.get(p) ?? null; }
  async writeFile(p: string, s: string, opts?: { mode?: number }) {
    this.files.set(p, s); this.addParents(p); this.writes.push(p);
    if (opts?.mode !== undefined) this.modes.set(p, opts.mode);
  }
  async copyFile(src: string, dst: string) {
    const s = this.files.get(src); if (s === undefined) throw new Error(`ENOENT ${src}`);
    await this.writeFile(dst, s);
  }
  async exists(p: string) { return this.files.has(p) || this.dirs.has(p); }
  async isDir(p: string) { return this.dirs.has(p); }
  async mkdirp(p: string) { this.dirs.add(p); this.addParents(p + "/x"); }
  async readdir(p: string) {
    if (!this.dirs.has(p)) return [];
    const out = new Set<string>();
    for (const f of this.files.keys()) if (path.posix.dirname(f) === p) out.add(path.posix.basename(f));
    for (const d of this.dirs) if (path.posix.dirname(d) === p) out.add(path.posix.basename(d));
    return [...out];
  }
  async exec(cmd: string, args: string[], opts: ExecOpts = {}) {
    const call = { cmd, args, opts }; this.calls.push(call);
    for (const h of this.handlers) if (h.match(cmd, args)) return h.handler(call);
    return { code: 127, stdout: "", stderr: `${cmd}: not handled` };
  }
  async which(cmd: string) { return this.pathMap[cmd] ?? null; }
}
