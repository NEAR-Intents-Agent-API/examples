/**
 * Read everything about one agent.
 *
 * What: agent identity, custody wallet and its NEAR address, policy with live USD usage and its
 *       signed revisions, public and confidential balances, grants, recent history, and the
 *       custody provider's own request records, in one pass.
 * When: after creating an agent; this is the read shape your dashboard will render.
 * Needs: `AGENT_API_KEY`, `AGENT_ID`.
 * Run: `pnpm 02:inspect-agent`
 *
 * Reads report what their source can prove. `policy.policy` is the configured rulebook
 * (`actions`, `assets`, `limits`, `destinations`, `budget`, `timelock_ms`); `policy.usage` is what
 * has actually been counted, from one database snapshot. A per-transaction maximum never
 * decreases; a window allowance does.
 *
 * `listProviderRecords` returns the custody provider's records unchanged (`requests`, `audit`,
 * `deposits`, `deposit_history`). Use it to reconcile, not to drive your UI: its shape is the
 * provider's, not this API's.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";

export async function inspectAgent(agentId: string) {
  const api = agentApi();
  const [
    agent,
    wallet,
    address,
    policy,
    revisions,
    balances,
    confidential,
    grants,
    history,
    providerRequests,
  ] = await Promise.all([
    api.getAgent(agentId),
    api.getWallet(agentId),
    // The custody wallet's NEAR account, e.g. for explorers. Fund the agent with `05:deposit`.
    api.getAddress(agentId, "near"),
    api.getPolicy(agentId),
    // Newest first; pass `next_cursor` as `cursor` for older revisions.
    api.getPolicyHistory(agentId, { limit: 5 }),
    api.getBalances(agentId, { source: "public" }),
    api.getBalances(agentId, { source: "confidential" }),
    api.listGrants(agentId),
    api.getHistory(agentId, { limit: 5 }),
    api.listProviderRecords(agentId, "requests", { limit: 5 }),
  ]);
  const format = (list: typeof balances.balances) =>
    list.map((entry) => ({
      asset_id: entry.asset_id,
      symbol: entry.symbol,
      // Use balance_raw for arithmetic; balance is exact but for display.
      balance_raw: entry.balance_raw,
      balance: entry.balance ?? (entry.decimals === null ? null : undefined),
      usd_price: entry.price,
    }));
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      owner: agent.owner,
      owner_account: agent.owner_account,
      cooldowns: agent.cooldowns,
    },
    wallet,
    address: address.address,
    policy: {
      revision: policy.revision,
      status: policy.status,
      provider_policy_synced: policy.provider_policy_synced,
      budget: policy.usage.budget,
      timelock: policy.usage.timelock,
      // The rulebook as signed: actions, assets, limits, destinations, budget and timelock_ms.
      rules: policy.policy,
    },
    policy_revisions: revisions.data.map((revision) => ({
      revision: revision.revision,
      status: revision.status,
    })),
    balances: { public: format(balances.balances), confidential: format(confidential.balances) },
    grants: grants.map((grant) => ({
      grant_id: grant.grant_id,
      label: grant.label,
      expires_at: grant.expires_at,
      revoked_at: grant.revoked_at,
    })),
    history: history.data.map((entry) => ({
      correlation_id: entry.correlation_id,
      type: entry.type,
      status: entry.status,
      failure_code: entry.failure_code,
      updated_at: entry.updated_at,
    })),
    provider_requests: providerRequests.data,
    hint: "Atomic amounts are shown raw; decimals come from 01:list-tokens.",
  };
}

if (isMainModule(import.meta.url)) {
  const agentId = required(config().agentId, "AGENT_ID");
  banner([`Inspecting agent ${agentId}…`]);
  void inspectAgent(agentId).then(print);
}
