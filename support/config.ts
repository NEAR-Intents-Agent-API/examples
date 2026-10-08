import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads `examples/.env` and reads the typed example configuration.
 *
 * Only the API URL and key are universally required; every example validates the extra values it
 * needs and fails with the variable name. Reads never require `AGENT_ALLOW_WRITES`.
 */

/** The hosted mainnet API, also the SDK's default `baseUrl`. */
export const hostedApiUrl = "https://api.agentsonintents.com";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export type ExampleConfig = {
  apiUrl: string;
  apiKey?: string;
  ownerAccountId?: string;
  ownerPrivateKey?: string;
  ownerEvmPrivateKey?: string;
  agentId?: string;
  recipient?: string;
  signRecipient?: string;
  /** The transparency log origin proofs must name; pinned by you, never read from the API. */
  logOrigin: string;
  token: string;
  swapToToken: string;
  transferAmount: string;
  allowWrites: boolean;
  execute: boolean;
  requireApproval: boolean;
  agentCount: number;
  nearRpcUrl: string;
};

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function boolean(name: string, fallback: boolean) {
  const value = optional(name);
  if (!value) return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function positiveInteger(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const value = optional(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum)
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  return parsed;
}

function httpOrigin(name: string, fallback: string) {
  const value = optional(name) ?? fallback;
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${name} must be an HTTP(S) origin without credentials or a path`);
  return url.origin;
}

export function config(): ExampleConfig {
  const transferAmount = optional("AGENT_TRANSFER_AMOUNT") ?? "1";
  if (!/^[0-9]+$/.test(transferAmount))
    throw new Error("AGENT_TRANSFER_AMOUNT must be atomic token units (a decimal integer)");
  return {
    apiUrl: httpOrigin("NEAR_INTENTS_AGENT_API_URL", hostedApiUrl),
    apiKey: optional("NEAR_INTENTS_AGENT_API_KEY"),
    ownerAccountId: optional("AGENT_OWNER_ACCOUNT_ID"),
    ownerPrivateKey: optional("AGENT_OWNER_PRIVATE_KEY"),
    ownerEvmPrivateKey: optional("AGENT_OWNER_EVM_PRIVATE_KEY"),
    agentId: optional("AGENT_ID"),
    recipient: optional("AGENT_RECIPIENT"),
    signRecipient: optional("AGENT_SIGN_RECIPIENT"),
    // A deployment's log is `<API host>/log`; the hosted API's is `api.agentsonintents.com/log`.
    logOrigin: optional("AGENT_LOG_ORIGIN") ?? "api.agentsonintents.com/log",
    token: optional("AGENT_TOKEN") ?? "nep141:wrap.near",
    swapToToken: optional("AGENT_SWAP_TO") ?? "nep141:usdt.tether-token.near",
    transferAmount,
    allowWrites: boolean("AGENT_ALLOW_WRITES", false),
    execute: boolean("AGENT_EXECUTE", false),
    requireApproval: boolean("AGENT_REQUIRE_APPROVAL", false),
    agentCount: positiveInteger("AGENT_COUNT", 2, 20),
    nearRpcUrl: optional("AGENT_NEAR_RPC_URL") ?? "https://free.rpc.fastnear.com",
  };
}

/** Reads one required value, naming the variable in the error. */
export function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required for this example`);
  return value;
}

export function isMainModule(metaUrl: string) {
  return process.argv[1] !== undefined && fileURLToPath(metaUrl) === process.argv[1];
}

/**
 * Guard for examples that move money or change state. Called before the first request so a copied
 * `.env` never spends by accident.
 */
export function requireWrites(what = "this example") {
  if (!config().allowWrites) throw new Error(`Set AGENT_ALLOW_WRITES=true before running ${what}`);
}

/** Pretty-print any result; every example ends by printing what it read or changed. */
export function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

/** The first line of every example: what it will do. */
export function banner(lines: string[]) {
  console.log(`\n${lines.join("\n")}\n`);
}
