/**
 * Revoke grants from your backend with the API key alone.
 *
 * What: revokes one grant, or every live grant on the agent, with no owner signature, then proves
 *       the stored token no longer works and reads the grants back.
 * When: an incident response: a token or key may be compromised, a customer closes their account, or
 *       the owner is not reachable. It is the partner-side emergency stop.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`. No owner keys.
 * Run: `pnpm 04:partner-revoke [grant_id | all]`
 *
 * Without an argument it revokes the grant stored by `04:issue-grant`. Pass a `grant_id` for any
 * other grant, or `all` to revoke every live grant on the agent in one call.
 *
 * Grants are API records, so removing one needs no wallet signature (`03:revoke-and-audit` is the
 * owner's signed version). The grant's `revoked_reason` reads `partner_revoked` instead of
 * `owner_revoked`, and its next request is refused with `agent_grant_required`. Revoking a grant
 * that is already revoked or expired returns it unchanged.
 *
 * Only authority is removed. The owner's wallet and policy are untouched, the account is not frozen
 * (freezing is an owner action) and issuing a new grant still needs the owner. Work already
 * committed to dispatch cannot be recalled: `committed_correlation_ids` lists it, to follow with
 * `getStatus`; `committed_cancellations` lists limit-order cancels that may still reach the
 * provider; `committed_truncated` is true when more than 100 exist.
 *
 * Any API key of yours can do this to any grant of any of your agents, so keep this call off
 * workloads and CI.
 */
import { AgentApiError } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";

export async function partnerRevoke(agentId: string, target?: string) {
  const settings = config();
  const api = agentApi();

  if (target === "all") {
    const result = await api.revokeAllGrants(agentId);
    return {
      revoked: result.data.map((grant) => ({
        grant_id: grant.grant_id,
        revoked_reason: grant.revoked_reason,
      })),
      committed_correlation_ids: result.committed_correlation_ids,
      committed_cancellations: result.committed_cancellations,
      committed_truncated: result.committed_truncated,
    };
  }

  const stored = target ? undefined : await loadGrant(agentId);
  const grantId = target ?? stored?.grant_id;
  if (!grantId) throw new Error("no grant to revoke");
  const result = await api.revokeGrant(agentId, grantId);

  // The grant's own token is refused from now on. A session of a key or OIDC grant ends with it.
  const probe = stored
    ? await api
        .forGrant(stored.token)
        .swap(agentId, {
          origin_asset: settings.token,
          destination_asset: settings.swapToToken,
          amount: settings.transferAmount,
          dry: true,
        })
        .then(
          () => "still accepted",
          (error) => (error instanceof AgentApiError ? error.code : String(error)),
        )
    : undefined;

  return {
    revoked: { grant_id: result.grant.grant_id, revoked_reason: result.grant.revoked_reason },
    token_after_revoke: probe,
    // Work that reached its dispatch commitment before the revocation is not recalled.
    committed_correlation_ids: result.committed_correlation_ids,
    // Limit-order cancels sent with this grant that may still reach the provider: read those orders.
    committed_cancellations: result.committed_cancellations,
    committed_truncated: result.committed_truncated,
    live_grants: (await api.listGrants(agentId))
      .filter((grant) => grant.revoked_at === null && Date.parse(grant.expires_at) > Date.now())
      .map((grant) => grant.grant_id),
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("revoking grants");
  const target = process.argv[2];
  banner([
    `Revoking ${target === "all" ? "every live grant" : (target ?? "the stored grant")} with the API key alone…`,
  ]);
  void partnerRevoke(required(config().agentId, "AGENT_ID"), target).then(print);
}
