/**
 * Revoke one grant and see what remains.
 *
 * What: revokes the stored grant, then reads the containment report and grant list.
 * When: when a session ends, a client disconnects, or a token may be compromised.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 04:revoke-and-audit`
 *
 * Revocation stops only the work that grant authorizes; other grants and the API key are
 * untouched. Work already committed to dispatch cannot be recalled: the response lists its
 * correlation ids in `committed_correlation_ids`.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function revokeAndAudit(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();
  const stored = await loadGrant(agentId);

  const status = await runOwnerIntent(
    api,
    { type: "grant_revoke", agent_id: agentId, grant_id: stored.grant_id },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `revoke ${status.status}`);

  const [grants, containment] = await Promise.all([
    api.listGrants(agentId),
    api.getContainment(agentId),
  ]);
  return {
    revoked: status.type === "grant_revoke" ? status.details.grant_id : stored.grant_id,
    // Work that reached its dispatch commitment before the revocation is not recalled.
    committed_correlation_ids:
      status.type === "grant_revoke" ? status.details.committed_correlation_ids : null,
    live_grants: grants
      .filter((grant) => grant.revoked_at === null && Date.parse(grant.expires_at) > Date.now())
      .map((grant) => ({
        grant_id: grant.grant_id,
        label: grant.label,
        expires_at: grant.expires_at,
      })),
    containment: {
      wallet: containment.wallet,
      grants: containment.grants.data.length,
      pending_operations: containment.pending_operations.data.length,
    },
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("revoking a grant");
  banner(["Revoking the stored grant and auditing what remains…"]);
  void revokeAndAudit(required(config().agentId, "AGENT_ID")).then(print);
}
