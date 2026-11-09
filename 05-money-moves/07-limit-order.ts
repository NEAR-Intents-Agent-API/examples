/**
 * Place a limit order.
 *
 * What: always previews the order; places it when `AGENT_EXECUTE=true`, then reads it back.
 * When: selling `AGENT_TOKEN` for `AGENT_SWAP_TO` only at a price you name or better.
 * Needs: `AGENT_ID`, `AGENT_LIMIT_PRICE` and a policy whose `actions` include `limit_order`. The
 *        order spends `AGENT_TRANSFER_AMOUNT` of `AGENT_TOKEN` and must be worth at least 0.1 USD.
 *        The live order also needs a stored grant, `AGENT_ALLOW_WRITES=true` and `AGENT_EXECUTE=true`.
 * Run: `pnpm 05:limit-order`
 *
 * The preview needs only the API key: no grant, no idempotency key, no provider call. Like a swap
 * preview it never refuses for rules or balance; read `warnings` before you execute. A limit order
 * adds `amount_too_low`, `policy_price_deviation_exceeded` (the price is worse than the market by
 * more than the policy's `limit_order.max_deviation_bps`, 100 when omitted) and
 * `market_price_unavailable`; the live request refuses with the same codes.
 *
 * `quantity` is atomic units of the base asset and `price` is quote units per one whole base unit.
 * A `sell` spends `quantity` of the base asset; a `buy` spends `ceil(quantity × price)` of the
 * quote asset. Add `confidential: true` to use the confidential balance (the policy needs
 * `confidential` too). The order rests until it fills, is cancelled or reaches `deadline` (at
 * most seven days, the default).
 *
 * `SUCCESS` means the order is funded and resting, not filled: `details.order_id` names it, and
 * `getLimitOrder` reads its live `fill_status`. 1Click's own fee (20 bps) is in the order's
 * `app_fees`; it is not an API fee. The USD budget is charged when the order is placed and not
 * given back by a cancel (`08-limit-orders.ts`).
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

export async function limitOrder(agentId: string) {
  const settings = config();
  const api = agentApi();
  const order = {
    base_asset: settings.token,
    quote_asset: settings.swapToToken,
    side: "sell" as const,
    quantity: settings.transferAmount,
    price: required(settings.limitPrice, "AGENT_LIMIT_PRICE"),
    deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const preview = await api.placeLimitOrder(agentId, { ...order, dry: true });
  if (!settings.execute) {
    return {
      spend: preview.spend,
      quote: preview.quote,
      warnings: preview.warnings,
      note: "Preview only. Set AGENT_EXECUTE=true to place this order.",
    };
  }
  requireWrites("placing a limit order");
  const stored = await loadGrant(agentId);
  const status = await settleExecution(
    api,
    api.forGrant(stored.token).placeLimitOrder(agentId, order),
  );
  const orderId = status.type === "limit_order" ? status.details?.order_id : undefined;
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    order_id: orderId,
    // Read the order back: `SUCCESS` says it rests, the order says how much of it has filled.
    order: orderId ? await api.getLimitOrder(agentId, orderId) : undefined,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Previewing a limit order…"]);
  void limitOrder(required(config().agentId, "AGENT_ID")).then(print);
}
