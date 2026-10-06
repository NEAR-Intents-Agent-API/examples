/**
 * Change custody-provider rules with a NEAR owner (NEP-366).
 *
 * What: enables the `swap` action and raises the per-transaction cap. The custody provider
 *       enforces both, so the owner signs a gasless NEP-366 delegate action and the API's
 *       sponsor submits it on chain.
 * When: whenever the rulebook itself changes (actions, assets, limits, owner approval).
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 03:near-policy-provider`
 *
 * Compare with `01-policy-local.ts`: same `policy_update` request, different `intent.standard`
 * (`nep366` instead of `nep413`) and a real `transaction_hash` on success. Until the revision is
 * `APPLIED` with `provider_policy_synced: true`, executions are refused with `policy_not_ready`.
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
import { buildPolicyUpdate, waitForStatus } from "../../support/flow.js";
import { loadOwner } from "../../support/near-owner.js";
import { signNearIntent } from "../../support/sign-near-intent.js";

export async function updateProviderPolicy(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const request = await buildPolicyUpdate(api, agentId, (policy) => ({
    ...policy,
    actions: policy.actions.includes("swap") ? policy.actions : [...policy.actions, "swap"],
    // A swap needs its output asset to be allowed too.
    assets:
      policy.assets === "any" ? "any" : [...new Set([...policy.assets, settings.swapToToken])],
    limits: {
      ...policy.limits,
      per_transaction: {
        ...policy.limits.per_transaction,
        [settings.token]: "500000000000000000000000",
      },
    },
  }));

  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  const signedData = await signNearIntent(generated, keyPair, settings.nearRpcUrl);
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
    actions: policy.policy?.actions,
    per_transaction: policy.policy?.limits.per_transaction,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  banner(["Enabling swaps with a NEP-366 owner delegate…"]);
  void updateProviderPolicy(required(config().agentId, "AGENT_ID")).then(print);
}
