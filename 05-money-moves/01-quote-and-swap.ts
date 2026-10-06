/**
 * Quote and swap assets.
 *
 * What: always returns a quote; runs the swap when `AGENT_EXECUTE=true`.
 * When: converting one asset to another inside the agent's account.
 * Needs: `AGENT_ID`, a stored grant, and a policy whose `actions` include `swap`; `AGENT_ALLOW_WRITES=true` + `AGENT_EXECUTE=true`
 *        for the live swap.
 * Run: `pnpm 05:quote-and-swap`
 *
 * Always quote first: `dry: true` returns expected output and fees with no authority and no
 * idempotency key. Set `min_amount_out` on the live request to refuse a worse fill.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

export async function quoteAndSwap(agentId: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const quote = await bot.swap(agentId, {
    origin_asset: settings.token,
    destination_asset: settings.swapToToken,
    amount: settings.transferAmount,
    dry: true,
  });
  if (!settings.execute) {
    return {
      quote: quote.quote,
      note: "Quote only. Set AGENT_EXECUTE=true to execute this swap.",
    };
  }
  requireWrites("executing a swap");
  const status = await settleExecution(
    api,
    bot.swap(agentId, {
      origin_asset: settings.token,
      destination_asset: settings.swapToToken,
      amount: settings.transferAmount,
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
  banner(["Quoting a swap…"]);
  void quoteAndSwap(required(config().agentId, "AGENT_ID")).then(print);
}
