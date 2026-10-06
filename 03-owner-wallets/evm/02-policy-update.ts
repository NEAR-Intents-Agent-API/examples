/**
 * Update an agent's policy with an EVM owner.
 *
 * What: raises the per-transaction cap and the USD budget from an EVM wallet (EIP-712).
 * When: after `03:evm-create-agent`, or for any agent owned by an EVM address.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_OWNER_EVM_PRIVATE_KEY`, `AGENT_ID`.
 * Run: `pnpm 03:evm-policy-update`
 *
 * The signing standard depends on what changes: changes the custody provider enforces (actions,
 * assets, limits, owner approval) use the on-chain wallet request (still EIP-712); changes only the
 * API enforces (destinations, budget, timelock) use an EIP-712 consent message. Both look like
 * `intent.standard: "eip712"` to you; sign `intent.payload` as typed data either way.
 */
import { agentApi } from "../../support/client.js";
import {
  banner,
  config,
  isMainModule,
  print,
  required,
  requireWrites,
} from "../../support/config.js";
import { loadEvmOwner, signEvmIntent } from "../../support/evm-owner.js";
import { buildPolicyUpdate, waitForStatus } from "../../support/flow.js";

export async function updateEvmPolicy(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { account } = loadEvmOwner();

  const request = await buildPolicyUpdate(api, agentId, (policy) => ({
    ...policy,
    limits: {
      ...policy.limits,
      per_transaction: {
        ...policy.limits.per_transaction,
        [settings.token]: "2000000000000000000000000",
      },
    },
    budget: { daily_usd: "100", weekly_usd: "500", monthly_usd: null },
  }));

  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  const signedData = await signEvmIntent(account, generated);
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: signedData,
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);
  const policy = await api.getPolicy(agentId);
  return {
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    revision: policy.revision,
    provider_policy_synced: policy.provider_policy_synced,
    budget: policy.usage.budget,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  banner(["Updating policy with an EIP-712 owner signature…"]);
  void updateEvmPolicy(required(config().agentId, "AGENT_ID")).then(print);
}
