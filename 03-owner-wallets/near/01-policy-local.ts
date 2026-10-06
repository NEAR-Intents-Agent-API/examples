/**
 * Update budget and execution delay with a NEAR owner (NEP-413).
 *
 * What: changes only `budget` and `timelock_ms` — controls the API enforces itself — with one
 *       off-chain signature.
 * When: after creating an agent, to set a USD cap or a delay.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 03:near-policy-local`
 *
 * Because nothing the custody provider enforces changes, the API returns
 * `intent.standard: "nep413"` and the success receipt has `transaction_hash: null`. No blockchain transaction is sent. The same
 * off-chain signature path serves grant issuance and approvals.
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

export async function updateLocalPolicy(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  // 1. Read the current revision, then send the complete policy with the edit applied.
  const request = await buildPolicyUpdate(api, agentId, (policy) => ({
    ...policy,
    // All three windows must be present. null means uncapped; "0" allows no counted spend.
    // A supplied budget replaces all three caps, so send the ones you want to keep.
    budget: { daily_usd: "50", weekly_usd: "250", monthly_usd: null },
    // Every money action waits this long (milliseconds) before dispatch. 0 disables the delay.
    timelock_ms: 60_000,
  }));

  // 2. The API builds the exact bytes the owner signs.
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });

  // 3. The owner's wallet signs `intent.payload` unchanged. Here: a local keypair, off-chain.
  const signedData = await signNearIntent(generated, keyPair, settings.nearRpcUrl);

  // 4. Submit the wallet output; the API verifies it against the stored intent.
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: signedData,
  });

  // 5. Follow the revision until it is applied and the provider readback matches.
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);
  const policy = await api.getPolicy(agentId);
  return {
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    revision: policy.revision,
    status: policy.status,
    provider_policy_synced: policy.provider_policy_synced,
    budget: policy.usage.budget,
    timelock: policy.usage.timelock,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  banner(["Updating budget and execution delay with a NEP-413 owner signature…"]);
  void updateLocalPolicy(required(config().agentId, "AGENT_ID")).then(print);
}
