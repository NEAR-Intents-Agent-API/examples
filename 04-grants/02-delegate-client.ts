/**
 * Act through a grant as a bot or assistant.
 *
 * What: loads the token from `04:issue-grant` and runs a dry swap under it.
 * When: this is the client shape you give an AI assistant, a scheduled job or a dashboard
 *       session. One grant per session; never share one token across sessions.
 * Needs: `AGENT_API_KEY`, `AGENT_ID`; the stored grant from `04:issue-grant`.
 * Run: `pnpm 04:delegate-client`
 *
 * `api.forGrant(token)` returns a client that sends `X-Grant-Token` on delegated calls only.
 * The same API key can hold many grant clients at once; concurrent calls never borrow another
 * grant's token.
 */

import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

export async function useGrant(agentId: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  // A dry quote needs no authority at all — it returns a quote without executing.
  const quote = await bot.swap(agentId, {
    origin_asset: settings.token,
    destination_asset: settings.swapToToken,
    amount: settings.transferAmount,
    dry: true,
  });
  if (!settings.execute) {
    return {
      grant: { grant_id: stored.grant_id, label: stored.label, expires_at: stored.expires_at },
      quote: quote.quote,
      note: "Dry quote only. Set AGENT_EXECUTE=true to run a live delegated action.",
    };
  }
  requireWrites("running a delegated execution");

  // A live swap runs under the grant. If the account policy turns swaps off, the API refuses with
  // `policy_action_denied`; enable them with `pnpm 03:near-policy-provider` first, and every
  // grant can swap at once.
  const status = await settleExecution(
    api,
    bot.swap(agentId, {
      origin_asset: settings.token,
      destination_asset: settings.swapToToken,
      amount: settings.transferAmount,
    }),
  );
  return {
    grant: { grant_id: stored.grant_id, label: stored.label },
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Running a delegated call under a stored grant…"]);
  void useGrant(required(config().agentId, "AGENT_ID")).then(print);
}
