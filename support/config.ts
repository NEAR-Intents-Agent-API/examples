import { fileURLToPath } from "node:url";
import { parseExampleEnv } from "./env.js";

/**
 * The typed example configuration, read from the validated environment (`support/env.ts`).
 *
 * The API URL and key are required by every example; every example validates the extra values it
 * needs and fails with the variable name. Reads never require `AGENT_ALLOW_WRITES`.
 */
export type ExampleConfig = {
  apiUrl: string;
  apiKey: string;
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

let cached: ExampleConfig | undefined;

export function config(): ExampleConfig {
  if (cached) return cached;
  const env = parseExampleEnv();
  const api = new URL(env.NEAR_INTENTS_AGENT_API_URL);
  cached = {
    apiUrl: api.origin,
    apiKey: env.NEAR_INTENTS_AGENT_API_KEY,
    ownerAccountId: env.AGENT_OWNER_ACCOUNT_ID,
    ownerPrivateKey: env.AGENT_OWNER_PRIVATE_KEY,
    ownerEvmPrivateKey: env.AGENT_OWNER_EVM_PRIVATE_KEY,
    agentId: env.AGENT_ID,
    recipient: env.AGENT_RECIPIENT,
    signRecipient: env.AGENT_SIGN_RECIPIENT,
    // A deployment's log is `<API host>/log`: `api.agentsonintents.com/log` for the hosted API.
    logOrigin: env.AGENT_LOG_ORIGIN ?? `${api.host}/log`,
    token: env.AGENT_TOKEN,
    swapToToken: env.AGENT_SWAP_TO,
    transferAmount: env.AGENT_TRANSFER_AMOUNT,
    allowWrites: env.AGENT_ALLOW_WRITES,
    execute: env.AGENT_EXECUTE,
    requireApproval: env.AGENT_REQUIRE_APPROVAL,
    agentCount: env.AGENT_COUNT,
    nearRpcUrl: env.AGENT_NEAR_RPC_URL,
  };
  return cached;
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
