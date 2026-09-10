import { EventEmitter } from "node:events";

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

/** What Ink needs from stdout: columns + write. Frames are kept raw; readers get them ANSI-stripped. */
export class FakeStdout extends EventEmitter {
  columns = 100; rows = 40; isTTY = true; frames: string[] = [];
  write(s: string): boolean { this.frames.push(s); return true; }
  // Ink's unmount writes teardown-only frames after the app's last real content (e.g. the cursor-show
  // escape, or a bare newline) — skip frames that are blank once stripped so callers see the last real frame.
  lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const stripped = stripAnsi(this.frames[i]);
      if (stripped.trim() !== "") return stripped;
    }
    return "";
  }
  all(): string { return stripAnsi(this.frames.join("\n")); }
}
/** What Ink needs from stdin: a readable that supports raw mode. write() feeds one chunk. */
export class FakeStdin extends EventEmitter {
  isTTY = true; private data: string | null = null;
  setRawMode(): void {} setEncoding(): void {} ref(): void {} unref(): void {} resume(): void {} pause(): void {}
  read(): string | null { const d = this.data; this.data = null; return d; }
  write(s: string): void { this.data = s; this.emit("readable"); this.emit("data", s); }
}
export async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error("waitFor: condition not met in time"); await new Promise((r) => setTimeout(r, 10)); }
}
