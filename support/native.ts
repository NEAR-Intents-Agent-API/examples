import type { Policy } from "@near-intents-agent-api/sdk";
import { agentApi } from "./client.js";
import { config } from "./config.js";
import { buildPolicyUpdate, waitForStatus } from "./flow.js";
import { loadOwner } from "./near-owner.js";
import { signNearIntent } from "./sign-near-intent.js";

/**
 * The policy's `native` block: the agent's own NEAR, EVM and Solana keys outside NEAR Intents.
 *
 * Omitted means every method is off. When present every key is required, so start from
 * `nativeOff` and switch on only what the owner asked for. A policy update replaces the whole
 * policy: leaving `native` out of an update turns every method off.
 */
export type NativeRules = NonNullable<Policy["native"]>;

export const nativeOff: NativeRules = {
  near: { sign_message: [], transfer: false, call: [] },
  evm: { sign_typed_data: [], sign_message: false, sign_transaction: false },
  solana: { sign_message: false, sign_transaction: false },
};

/** True when no method is on, so the policy should omit `native`. */
export function allOff(native: NativeRules) {
  return (
    native.near.sign_message.length === 0 &&
    !native.near.transfer &&
    native.near.call.length === 0 &&
    native.evm.sign_typed_data.length === 0 &&
    !native.evm.sign_message &&
    !native.evm.sign_intent &&
    !native.evm.sign_transaction &&
    (native.solana.sign_in ?? []).length === 0 &&
    !native.solana.sign_message &&
    !native.solana.sign_intent &&
    !native.solana.sign_transfer &&
    !native.solana.sign_transaction
  );
}

/**
 * Signs and applies one owner policy change, the way `07:enable-native` does: read the current
 * policy, let `edit` return the complete new one, check the 10-minute policy cooldown, have the
 * NEAR owner sign (`nep366`, gas sponsored by the API) and wait until it is applied. Returns
 * `null` when `edit` changes nothing.
 */
export async function changePolicy(agentId: string, edit: (policy: Policy) => Policy) {
  const api = agentApi();
  const { keyPair } = loadOwner();

  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(`Policy changes are throttled until ${availableAt}; run this after that.`);

  const current = (await api.getPolicy(agentId)).policy;
  if (current && JSON.stringify(edit(structuredClone(current))) === JSON.stringify(current))
    return null;

  const request = await buildPolicyUpdate(api, agentId, edit);
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  // Your UI shows `generated.preview` (it lists every switch that is on) and a warning here, then
  // asks the owner to sign.
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, config().nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);

  // The change works once the revision is APPLIED and synced with the provider.
  const after = await api.getPolicy(agentId);
  return {
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    status: after.status,
    provider_policy_synced: after.provider_policy_synced,
    policy: after.policy,
  };
}

/**
 * The EIP-712 domain the examples list and sign under. A request's `domain` must equal one listed
 * entry field for field, so a missing or extra field (another `chainId`, another contract) is a
 * different domain and is refused. List domains as narrowly as the app allows.
 */
export const exampleDomain = {
  name: "NEAR Intents Agent API Example",
  version: "1",
  chain_id: 42161,
};

/** Typed data under `exampleDomain`. `types.EIP712Domain` may be omitted; the API derives it. */
export function exampleTypedData(contents: string) {
  return {
    domain: {
      name: exampleDomain.name,
      version: exampleDomain.version,
      chainId: exampleDomain.chain_id,
    },
    types: { Note: [{ name: "contents", type: "string" }] },
    primaryType: "Note" as const,
    message: { contents },
  };
}
