import path from "node:path";
import { pj, type Env, type Os } from "../env.ts";
import type { Io } from "../io.ts";
import { KeychainStore } from "./keychain.ts";
import { PasswordVaultStore } from "./passwordvault.ts";
import { FileStore, SingleFileStore } from "./filestore.ts";

export type SecretService = "cornell-ai-gateway" | "mecp-device-token" | "mecp-api-key" | "mct-sync-token";
export interface SecretRef { service: SecretService; account: string }

export interface SecretStore {
  get(ref: SecretRef): Promise<string | null>;
  set(ref: SecretRef, value: string): Promise<void>;
  describe(ref: SecretRef): string;
}

export const MECP_API_KEY_FILE = (home: string, os: Os) => pj(os, home, ".config", "mecp", "api_key");

export function defaultAccount(io: Io): string {
  return io.env.USER || io.env.USERNAME || "user";
}

function osStore(env: Env, io: Io): SecretStore {
  if (env.os === "darwin") return new KeychainStore(io);
  if (env.os === "win32") return new PasswordVaultStore(io);
  return new FileStore(io, path.join(env.home, ".config", "boot-slapper", "secrets"));
}

/** Composite: the hook-contract file for mecp-api-key, the OS store for everything else. */
export function selectStore(env: Env, io: Io): SecretStore {
  const os = osStore(env, io);
  const apiKey = new SingleFileStore(io, MECP_API_KEY_FILE(env.home, env.os));
  const pick = (ref: SecretRef) => (ref.service === "mecp-api-key" ? apiKey : os);
  return {
    get: (ref) => pick(ref).get(ref),
    set: (ref, v) => pick(ref).set(ref, v),
    describe: (ref) => pick(ref).describe(ref),
  };
}
