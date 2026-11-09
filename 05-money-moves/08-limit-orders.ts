/**
 * List, read and cancel limit orders.
 *
 * What: lists the open orders and reads the newest; with `AGENT_EXECUTE=true` cancels it, then
 *       cancels every other open order.
 * When: managing the orders `07-limit-order.ts` (or any grant) left resting.
 * Needs: `AGENT_ID`. Cancelling also needs a stored grant, `AGENT_ALLOW_WRITES=true` and
 *        `AGENT_EXECUTE=true`. The reads need only the API key.
 * Run: `pnpm 05:limit-orders`
 *
 * `listLimitOrders` answers newest first as `{ data }` (`limit` at most 100, then `offset`). A
 * listed order's status is not refreshed; `getLimitOrder` reads the live `fill_status`,
 * `partial_fills` and `payouts`. A cancel refunds what is unfilled to the balance that funded the
 * order, needs a live grant but no timelock, schedule or approval, and works while the agent is
 * frozen or its policy no longer allows `limit_order`. The USD budget charged when the order was
 * placed is not given back.
 *
 * `cancelAllLimitOrders` cancels at most 50 orders a call. Repeat it until `complete` is true;
 * this example also stops when a round cancels nothing, since a repeat would only fail again.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";

export async function limitOrders(agentId: string) {
  const settings = config();
  const api = agentApi();

  const open = (await api.listLimitOrders(agentId, { open: true, limit: 20 })).data;
  const newest = open[0];
  const live = newest ? await api.getLimitOrder(agentId, newest.order_id) : undefined;
  if (!settings.execute || !newest) {
    return {
      open_orders: open.length,
      newest: live,
      note: newest
        ? "Read only. Set AGENT_EXECUTE=true to cancel the open orders."
        : "No open orders. Place one with `pnpm 05:limit-order`.",
    };
  }

  requireWrites("cancelling limit orders");
  const bot = api.forGrant((await loadGrant(agentId)).token);
  const cancelled = await bot.cancelLimitOrder(agentId, newest.order_id);
  let round = await bot.cancelAllLimitOrders(agentId);
  const rounds = [round];
  while (!round.complete && round.cancelled > 0) {
    round = await bot.cancelAllLimitOrders(agentId);
    rounds.push(round);
  }
  return {
    cancelled_one: cancelled,
    cancel_all_rounds: rounds,
    still_open: (await api.listLimitOrders(agentId, { open: true })).data.length,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Listing open limit orders…"]);
  void limitOrders(required(config().agentId, "AGENT_ID")).then(print);
}
