import type { Policy } from "@near-intents-agent-api/sdk";

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
    !native.evm.sign_transaction &&
    !native.solana.sign_message &&
    !native.solana.sign_transaction
  );
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
