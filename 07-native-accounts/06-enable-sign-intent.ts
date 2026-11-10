/**
 * Let the agent's EVM key sign NEAR Intents payloads, within `sign_intent` rules.
 *
 * What: sets `native.evm.sign_intent` to `receivers: []`, `one_click_deposits: true`,
 *       `max_slippage_bps: 100` and, when `AGENT_WITHDRAW_ADDRESS` is set, one `withdrawals` entry
 *       for that address on Base. Every other switch keeps its value.
 * When: the agent should swap inside NEAR Intents, or pay out to one of the owner's own
 *       addresses (a withdrawal, or funding a venue), from its EVM Intents account.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`; `AGENT_WITHDRAW_ADDRESS` for a payout.
 * Run: `pnpm 07:enable-sign-intent`
 *
 * `sign_intent` is the only way the EVM key signs a NEAR Intents payload (`evm.sign_message`
 * refuses one), and only `transfer` intents:
 * - `receivers`: NEAR Intents accounts a transfer may pay. Empty here: nothing is paid directly.
 * - `one_click_deposits`: a transfer may also fund a 1Click deposit address, given the live quote
 *   1Click signed for it (`one_click_quotes`) that pays the key (or a receiver) inside Intents and
 *   refunds the key.
 * - `withdrawals`: such a deposit may also pay out to a listed address on another chain. List only
 *   the owner's own addresses; spell the address as `destinations` does (lowercase for EVM).
 * - `max_slippage_bps` (0 to 300, 100 when omitted): the value the quote may lose at its
 *   `minAmountOut`, fees and slippage included, by 1Click's signed USD amounts.
 *
 * These rules are the key's own: `destinations`, `assets`, `limits`, `budget`, `timelock_ms`,
 * `schedule` and `owner_approval` do not apply. No amount limit applies either: the loss is
 * bounded by that slippage cap. The wallet provider enforces the policy, so this is an
 * on-chain change with the 10-minute cooldown, like `07:enable-native`.
 *
 * Solana has the same rules under `native.solana.sign_intent`.
 */
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { changePolicy, nativeOff, type NativeRules } from "../support/native.js";

/** What your UI shows the owner before they sign a policy that turns on `sign_intent`. */
export const signIntentWarning =
  "The agent's EVM key may sign payments from its own NEAR Intents account to 1Click deposit addresses whose quote pays that account back or pays one of the listed addresses, for exactly the quoted amount, losing no more than the slippage cap, fees included. Your destinations, assets, limits and budget do not apply. A signed payload can be published by anyone who holds it until its deadline, up to 96 hours, and freezing the account does not recall one already signed.";

export async function enableSignIntent(agentId: string, withdrawAddress: string | undefined) {
  const result = await changePolicy(agentId, (policy) => {
    const native: NativeRules = structuredClone(policy.native ?? nativeOff);
    native.evm.sign_intent = {
      receivers: [],
      one_click_deposits: true,
      ...(withdrawAddress
        ? { withdrawals: [{ chain: "base", address: withdrawAddress.toLowerCase() }] }
        : {}),
      max_slippage_bps: 100,
    };
    return { ...policy, native };
  });
  return result
    ? { warning_shown: signIntentWarning, ...result }
    : { unchanged: "the same sign_intent rules are already in place" };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  banner([
    `Letting the agent's EVM key sign Intents payloads${settings.withdrawAddress ? `, with payouts to ${settings.withdrawAddress} on Base` : ""}…`,
  ]);
  void enableSignIntent(required(settings.agentId, "AGENT_ID"), settings.withdrawAddress).then(
    print,
  );
}
