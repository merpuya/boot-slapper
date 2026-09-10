import path from "node:path";
import type { Os } from "../env.ts";
import type { Io } from "../io.ts";
import type { SecretRef, SecretStore } from "./store.ts";

/** One file per service under <dir>, mode 600. Linux fallback only. */
export class FileStore implements SecretStore {
  constructor(private io: Io, private os: Os, private dir: string) {}
  private file(ref: SecretRef) {
    const P = this.os === "win32" ? path.win32 : path.posix;
    return P.join(this.dir, ref.service);
  }
  async get(ref: SecretRef) {
    const s = await this.io.readFile(this.file(ref));
    const v = s?.trim() ?? "";
    return v.length ? v : null;
  }
  async set(ref: SecretRef, value: string) {
    await this.io.mkdirp(this.dir, { mode: 0o700 });
    await this.io.writeFile(this.file(ref), value + "\n", { mode: 0o600 });
  }
  describe(ref: SecretRef) { return `file ${this.file(ref)} (mode 600)`; }
}

/** A single fixed file regardless of ref — the ~/.config/mecp/api_key hook contract. */
export class SingleFileStore implements SecretStore {
  constructor(private io: Io, private os: Os, private file: string) {}
  private dir() {
    const P = this.os === "win32" ? path.win32 : path.posix;
    return P.dirname(this.file);
  }
  async get() {
    const s = await this.io.readFile(this.file);
    const v = s?.trim() ?? "";
    return v.length ? v : null;
  }
  async set(_ref: SecretRef, value: string) {
    await this.io.mkdirp(this.dir(), { mode: 0o700 });
    await this.io.writeFile(this.file, value + "\n", { mode: 0o600 });
  }
  describe() { return `file ${this.file} (mode 600)`; }
}
