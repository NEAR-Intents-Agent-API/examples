import type { Destination } from "@near-intents-agent-api/sdk";

/**
 * Typed destinations for the account policy's `destinations` rule.
 *
 * A destination names one place funds may go, exactly:
 * - `{ action: "transfer", address, confidential }`: a NEAR Intents account. A newly signed policy
 *   lists only confidential ones (`confidential: true`), since every transfer is confidential.
 * - `{ action: "withdraw", chain, address, memo }`: an address on another chain. A withdrawal never
 *   carries a memo, so `memo` is signed as `null`; an entry with a memo matches nothing.
 *
 * The rule around the list has a `mode`: `only` allows just the listed entries (an empty list keeps
 * funds in the agent's own balances), `except` blocks the listed accounts under any memo, and
 * `any` allows every destination. EVM addresses must be canonical lowercase hex; other formats
 * keep their exact case. Deposits never go through destination checks.
 */

/** A payout to a NEAR Intents account (transfer target). */
export function intentsAccount(address: string, confidential = true): Destination {
  return { action: "transfer", address, confidential };
}

/** A payout to an external chain address (withdrawal target). */
export function chainAddress(input: { chain: string; address: string }): Destination {
  return { action: "withdraw", chain: input.chain, address: input.address, memo: null };
}
