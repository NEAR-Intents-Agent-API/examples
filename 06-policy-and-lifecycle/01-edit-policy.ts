/**
 * Edit a policy the safe way: read, change, sign the whole thing.
 *
 * What: adds a USD budget and a per-transaction cap to the current policy and applies it.
 * When: any rule change. This is the canonical `policy_update` shape.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 06:edit-policy`
 *
 * Always send the complete policy with the current `expected_revision`: every field is required and
 * nothing is merged for you, so spread the current policy and change only what you mean to. A
 * conflict (`policy_revision_conflict`) means someone else applied a revision
 * first: read again and generate a fresh intent.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function editPolicy(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const before = await api.getPolicy(agentId);
  const request = await buildPolicyUpdate(api, agentId, (policy) => ({
    ...policy,
    limits: {
      ...policy.limits,
      per_transaction: {
        ...policy.limits.per_transaction,
        [settings.token]: "500000000000000000000000",
      },
    },
    budget: { daily_usd: "100", weekly_usd: "500", monthly_usd: "2000" },
    // Milliseconds every money action waits before dispatch; 0 means no delay.
    timelock_ms: 0,
  }));

  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);
  const after = await api.getPolicy(agentId);
  return {
    revision: { before: before.revision, after: after.revision },
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    provider_policy_synced: after.provider_policy_synced,
    per_transaction: after.policy?.limits.per_transaction,
    budget: after.usage.budget,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  banner(["Editing the policy with the complete revision…"]);
  void editPolicy(required(config().agentId, "AGENT_ID")).then(print);
}
