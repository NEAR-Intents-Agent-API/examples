/**
 * Withdraw to an external chain address.
 *
 * What: previews fees, then withdraws when `AGENT_EXECUTE=true`. The preview runs under the grant
 *       and its own idempotency key, which the SDK creates; previews are limited per agent per day.
 * When: moving value out of NEAR Intents to a chain address.
 * Needs: `AGENT_ID`, a stored grant, and a policy whose `actions` include `withdraw` and whose
 *        `destinations` allow the exact chain address;
 *        `AGENT_ALLOW_WRITES=true` + `AGENT_EXECUTE=true` for the live withdrawal.
 * Run: `pnpm 05:withdraw`
 *
 * Cross-chain bridges outlive a synchronous request. `async: true` returns as soon as the bridge
 * accepts the request; keep following the correlation id. The recipient, chain and memo must match a
 * policy destination exactly — including the memo (`null` means no memo).
 *
 * The preview never refuses for rules or balance: an action or destination the policy does not
 * allow (`policy_action_denied`, `policy_destination_denied`), an unsupported token, an invalid
 * address or too little available balance (`insufficient_balance` with `available_amount`) is
 * listed in `warnings`, so read them before the live withdrawal. A refusal the provider states
 * before it quotes gives its daily preview attempt back. As with a swap, `details.amount_out` in
 * the live status is final only on `SUCCESS`; before that read `details.expected_amount_out`.
 */
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

if (isMainModule(import.meta.url)) {
  banner(["Previewing a cross-chain withdrawal…"]);
  void withdraw(required(config().agentId, "AGENT_ID")).then(print);
}
