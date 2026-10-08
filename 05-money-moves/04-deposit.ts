/**
 * Issue a deposit address and wait for funds.
 *
 * What: creates a deposit address that credits the agent's Intents balance, then polls.
 * When: funding an agent from another chain or token.
 * Needs: `AGENT_ALLOW_WRITES=true`, `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`. No grant: inbound funding never
 *        spends agent funds.
 * Run: `pnpm 05:deposit`
 *
 * Creating an address needs only the API key and an idempotency key. No grant signature,
 * destination rule, budget charge or execution delay applies. Each new key creates a new address
 * (500 per tenant per rolling 24 hours); the same key returns the same one, so keep it for
 * retries. The status stays `PENDING_DEPOSIT` until the deposit arrives.
 *
 * `origin_asset` names the token and chain the payer sends from. `amount` is optional: without it
 * any payment at or above `details.min_amount` before `details.expires_at` is credited. There is
 * no refund address to choose: a failed or late deposit refunds into the agent's own balance
 * (`details.refund_to`).
 *
 * `shield`/`unshield` move between existing balances; this endpoint brings in new value.
 */
import { createIdempotencyKey } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";

export async function deposit(agentId: string, amount?: string) {
  const settings = config();
  const api = agentApi();
  const status = await api.deposit(
    agentId,
    { origin_asset: settings.token, ...(amount === undefined ? {} : { amount }) },
    // A real backend stores this key with the request before sending it.
    { idempotencyKey: createIdempotencyKey() },
  );
  const { details } = status;
  return {
    correlation_id: status.correlation_id,
    idempotency_key: status.idempotencyKey,
    status: status.status,
    // Funds go only to `deposit_address`, with `memo` when the chain needs one.
    deposit_address: details.deposit_address,
    memo: details.memo ?? null,
    min_amount: details.min_amount,
    expires_at: details.expires_at,
    refund_to: details.refund_to,
    note: "Send at least min_amount to deposit_address before expires_at, then poll the correlation id.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("creating a deposit address");
  banner(["Creating a deposit address…"]);
  void deposit(required(config().agentId, "AGENT_ID")).then(print);
}
