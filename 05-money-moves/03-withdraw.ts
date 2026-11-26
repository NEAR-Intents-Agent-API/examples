/**
 * Withdraw to an external chain address.
 *
 * What: previews fees, then withdraws when `AGENT_EXECUTE=true`. The preview runs under the grant
 *       and its own idempotency key, which the SDK creates; previews are limited per agent per day.
 * When: moving value out of NEAR Intents to a chain address.
 * Needs: `AGENT_ID`, a stored grant, and a policy whose `actions` include `withdraw` and whose
 *        `destinations` allow the exact chain address;
 *        `AGENT_ALLOW_WRITES=true` + `AGENT_EXECUTE=true` for the live withdrawal.
 * Run: `pnpm 05:withdraw` (exact input) or `pnpm 05:withdraw exact-output`
 *
 * A withdrawal pays from the confidential balance by default. `confidential: false` is the one exit
 * for the legacy public balance (pass it with the same amount, chain and recipient); the policy
 * judges that withdrawal like any other.
 *
 * Cross-chain bridges outlive a synchronous request. `async: true` returns as soon as the bridge
 * accepts the request; keep following the correlation id. The recipient and chain must match a
 * policy destination exactly, which carries `memo: null`: a withdrawal takes no `memo`, and an
 * entry with a memo matches nothing. NEAR (`nep141:wrap.near`) withdrawn to chain `near` arrives as
 * native NEAR, so the recipient needs no `wrap.near` registration.
 *
 * `amount` is exact input: the debit, with fees taken out of what arrives. `exact-output` fixes the
 * delivery instead: `amount_out` with `max_amount_in`, the most it may spend (the dry run's
 * `quote.amount_in` plus 1% here). Unused input returns to the balance, but the balance check,
 * limits and USD budget count the whole ceiling. A `max_amount_in` below the fresh quote's
 * `amount_in` is refused with `above_max_amount_in` (409, nothing sent). Exact input may also send
 * `min_amount_out`; one above the quote's guaranteed output is refused with `below_min_amount_out`.
 * A settled exact-output withdrawal reports the input it spent in `details.amount_in`. A
 * withdrawal from the public balance (`confidential: false`) to chain `near` takes `amount` alone.
 *
 * The preview never refuses for rules or balance: an action or destination the policy does not
 * allow (`policy_action_denied`, `policy_destination_denied`) or too little available balance
 * (`insufficient_balance` with `available_amount`) is listed in `warnings`, so read them before the
 * live withdrawal. An unlisted token (`unsupported_token`) or an invalid address (`invalid_address`)
 * refuses the preview itself, before any provider call. So does a token withdrawn to a NEAR account
 * with no storage on that token's contract (`recipient_storage_unregistered`, 409): register the
 * receiver's storage first, or move the funds inside NEAR Intents. Each preview counts toward the
 * wallet's 1,000 daily custody operations at the provider. As with a swap, `details.amount_out` in
 * the live status is final only on `SUCCESS`; before that read `details.expected_amount_out`.
 */
import { maxAmountIn } from "../support/amounts.js";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

// A withdrawal destination. It must be allowed by the policy's `destinations` rule.
const DESTINATION = { chain: "near", recipient: "" };

export async function withdraw(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = DESTINATION.recipient || required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const preview = await bot.withdraw(agentId, {
    asset: settings.token,
    amount: settings.transferAmount,
    chain: DESTINATION.chain,
    recipient,
    dry: true,
  });
  if (!settings.execute) {
    return {
      preview: preview.quote,
      warnings: preview.warnings,
      note: "Dry preview only. Set AGENT_EXECUTE=true to withdraw.",
    };
  }
  requireWrites("executing a withdrawal");
  const status = await settleExecution(
    api,
    bot.withdraw(agentId, {
      asset: settings.token,
      amount: settings.transferAmount,
      chain: DESTINATION.chain,
      recipient,
      async: true,
    }),
  );
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    details: status.details,
  };
}

export async function withdrawExactOutput(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = DESTINATION.recipient || required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);
  const target = { asset: settings.token, chain: DESTINATION.chain, recipient };

  // Pick a delivery the route can meet: the guaranteed output of an exact-input preview.
  const exactInput = await bot.withdraw(agentId, {
    ...target,
    amount: settings.transferAmount,
    dry: true,
  });
  const amountOut = exactInput.quote.min_amount_out ?? exactInput.quote.amount_out;
  if (amountOut === undefined) throw new Error("The preview has no output to target");

  // The dry run needs a ceiling too: the exact-input amount bounds what this delivery costs.
  const preview = await bot.withdraw(agentId, {
    ...target,
    amount_out: amountOut,
    max_amount_in: settings.transferAmount,
    dry: true,
  });
  const ceiling = maxAmountIn(preview.quote);
  if (!settings.execute) {
    return {
      preview: preview.quote,
      max_amount_in: ceiling,
      warnings: preview.warnings,
      note: "Dry preview only. Set AGENT_EXECUTE=true to withdraw.",
    };
  }
  requireWrites("executing an exact-output withdrawal");
  const status = await settleExecution(
    api,
    bot.withdraw(agentId, {
      ...target,
      amount_out: amountOut,
      max_amount_in: ceiling,
      async: true,
    }),
  );
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    // `amount_in` is what it spent of `max_amount_in`; the rest is back in the balance.
    amount_in: status.type === "withdraw" ? status.details.amount_in : undefined,
    amount_out: status.type === "withdraw" ? status.details.amount_out : undefined,
    details: status.details,
  };
}

if (isMainModule(import.meta.url)) {
  const exactOutput = process.argv[2] === "exact-output";
  banner([
    exactOutput
      ? "Previewing an exact-output cross-chain withdrawal…"
      : "Previewing a cross-chain withdrawal…",
  ]);
  const agentId = required(config().agentId, "AGENT_ID");
  void (exactOutput ? withdrawExactOutput(agentId) : withdraw(agentId)).then(print);
}
