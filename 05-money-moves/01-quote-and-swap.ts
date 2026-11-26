/**
 * Quote and swap assets.
 *
 * What: always returns a quote; runs the swap when `AGENT_EXECUTE=true`.
 * When: converting one asset to another inside the agent's account.
 * Needs: `AGENT_ID`, a stored grant, and a policy whose `actions` include `swap`; `AGENT_ALLOW_WRITES=true` + `AGENT_EXECUTE=true`
 *        for the live swap.
 * Run: `pnpm 05:quote-and-swap` (exact input) or `pnpm 05:quote-and-swap exact-output`
 *
 * Always quote first: `dry: true` returns expected output and fees with no authority and no
 * idempotency key. Set `min_amount_out` on the live request to send the provider a minimum output;
 * the quote does not apply it, and a swap reported below it reads `NEEDS_REVIEW`, never `SUCCESS`.
 * A live `min_amount_out` above the fresh quote's guaranteed `min_amount_out` is refused with
 * `below_min_amount_out` (409, nothing sent); a dry run whose quote already misses it warns.
 *
 * Exact output (`exact-output`) fixes what the swap delivers: `amount_out` with `max_amount_in`,
 * the most it may spend, never with `amount` or `min_amount_out`. The ceiling here is the dry run's
 * `quote.amount_in` plus 1%; a `max_amount_in` below the fresh quote's `amount_in` is refused with
 * `above_max_amount_in` (409, nothing sent). Unused input returns to the balance, but the balance
 * check, limits and USD budget count the whole ceiling. A settled exact-output swap reports the
 * input it spent in `details.amount_in`. The target is the guaranteed output of an exact-input
 * quote for `AGENT_TRANSFER_AMOUNT`, so the request can be met.
 *
 * A dry swap never refuses for rules or balance. Each check the live swap would fail comes back in
 * `warnings` under the live request's code (`policy_action_denied`, `policy_asset_denied`,
 * `insufficient_balance` with `available_amount`, a budget or limit code, ...), so read them before
 * executing. An unlisted asset (`unsupported_token`) refuses the quote itself. `owner_approval`
 * true means the live swap waits in `PENDING_APPROVAL` for the owner instead of running at once. In
 * the live status, `details.amount_out` is final and present only on `SUCCESS` (or `REFUNDED` after
 * a partial fill); until then `details.expected_amount_out` is an estimate.
 */
import { maxAmountIn } from "../support/amounts.js";
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
      warnings: quote.warnings,
      owner_approval: quote.owner_approval,
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

export async function quoteAndSwapExactOutput(agentId: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  // Pick an output the swap can deliver: the guaranteed output of an exact-input quote.
  const exactInput = await bot.swap(agentId, {
    origin_asset: settings.token,
    destination_asset: settings.swapToToken,
    amount: settings.transferAmount,
    dry: true,
  });
  const amountOut = exactInput.quote.min_amount_out ?? exactInput.quote.amount_out;
  if (amountOut === undefined) throw new Error("The quote has no output to target");
  const exactOutput = {
    origin_asset: settings.token,
    destination_asset: settings.swapToToken,
    amount_out: amountOut,
  };

  // The dry run needs a ceiling too: the exact-input amount bounds what this output costs.
  const quote = await bot.swap(agentId, {
    ...exactOutput,
    max_amount_in: settings.transferAmount,
    dry: true,
  });
  const ceiling = maxAmountIn(quote.quote);
  if (!settings.execute) {
    return {
      quote: quote.quote,
      max_amount_in: ceiling,
      warnings: quote.warnings,
      owner_approval: quote.owner_approval,
      note: "Quote only. Set AGENT_EXECUTE=true to execute this swap.",
    };
  }
  requireWrites("executing an exact-output swap");
  const status = await settleExecution(
    api,
    bot.swap(agentId, { ...exactOutput, max_amount_in: ceiling }),
  );
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    // `amount_in` is what it spent of `max_amount_in`; the rest is back in the balance.
    amount_in: status.type === "swap" ? status.details.amount_in : undefined,
    amount_out: status.type === "swap" ? status.details.amount_out : undefined,
    details: status.details,
  };
}

if (isMainModule(import.meta.url)) {
  const exactOutput = process.argv[2] === "exact-output";
  banner([exactOutput ? "Quoting an exact-output swap…" : "Quoting a swap…"]);
  const agentId = required(config().agentId, "AGENT_ID");
  void (exactOutput ? quoteAndSwapExactOutput(agentId) : quoteAndSwap(agentId)).then(print);
}
