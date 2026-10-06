/**
 * Issue a deposit address and wait for funds.
 *
 * What: creates a deposit address that credits the agent's Intents balance, then polls.
 * When: funding an agent from another chain or token.
 * Needs: `AGENT_API_KEY`, `AGENT_ID`. No grant: inbound funding never spends agent funds.
 * Run: `pnpm 05:deposit`
 *
 * Creating an address needs only the API key and an idempotency key. No grant signature,
 * destination rule, budget charge or execution delay applies. The status stays
 * `PENDING_DEPOSIT` until the deposit arrives; keep the idempotency key for retries.
 *
 * `shield`/`unshield` move between existing balances; this endpoint brings in new value.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";

export async function deposit(agentId: string) {
  const settings = config();
  const api = agentApi();
  const status = await api.deposit(
    agentId,
    {
      // `origin_asset` fixes the source chain; `refund_to` receives a refund if the bridge fails.
      origin_asset: settings.token,
      amount: settings.transferAmount,
      refund_to: settings.recipient,
    },
    { idempotencyKey: `example-deposit-${agentId}` },
  );
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    deposit_address: status.details.deposit_address,
    note: "Send the tokens to deposit_address from the source chain, then poll status again.",
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Creating a deposit address…"]);
  void deposit(required(config().agentId, "AGENT_ID")).then(print);
}
