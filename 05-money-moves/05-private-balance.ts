/**
 * Move balances between public and confidential.
 *
 * What: shields (public → confidential) and unshields (confidential → public), then shows both
 *       balance sheets.
 * When: when some or all of an agent's activity should settle on the private shard.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, a stored grant, and a policy with
 *        `confidential: true`.
 * Run: `pnpm 05:private-balance`
 *
 * Confidential operations never silently fall back to public settlement. Shield and unshield
 * move value between the agent's own balances and name no recipient, so the policy's
 * `destinations` rule does not apply to them; `confidential: true` is what allows them.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

async function balances(api: ReturnType<typeof agentApi>, agentId: string) {
  const [publicBalances, confidentialBalances] = await Promise.all([
    api.getBalances(agentId, { source: "public" }),
    api.getBalances(agentId, { source: "confidential" }),
  ]);
  return {
    public: publicBalances.balances.map((entry) => ({
      asset_id: entry.asset_id,
      balance_raw: entry.balance_raw,
    })),
    confidential: confidentialBalances.balances.map((entry) => ({
      asset_id: entry.asset_id,
      balance_raw: entry.balance_raw,
    })),
  };
}

export async function movePrivate(agentId: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const shielded = await settleExecution(
    api,
    bot.shield(
      agentId,
      { asset: settings.token, amount: settings.transferAmount },
      { idempotencyKey: `${crypto.randomUUID()}-shield` },
    ),
  );
  const unshielded = await settleExecution(
    api,
    bot.unshield(
      agentId,
      { asset: settings.token, amount: settings.transferAmount },
      { idempotencyKey: `${crypto.randomUUID()}-unshield` },
    ),
  );
  return {
    shield: { status: shielded.status, failure_code: shielded.failure_code },
    unshield: { status: unshielded.status, failure_code: unshielded.failure_code },
    balances: await balances(api, agentId),
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("moving balances between public and confidential");
  banner(["Shielding and unshielding…"]);
  void movePrivate(required(config().agentId, "AGENT_ID")).then(print);
}
