/**
 * Issue an owner grant to a new token.
 *
 * What: creates a grant token, has the owner sign its commitment, and prints the grant.
 * When: before any delegated spend. One grant per session, assistant or bot.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 04:issue-grant`
 *
 * The token (`ngt_…`) never reaches the API: your backend sends only its SHA-256 commitment, so
 * the owner signs the exact credential that will use the grant. Store the token encrypted; it is
 * shown nowhere else.
 */

import { createGrantCredential } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent } from "../support/flow.js";
import { saveGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function issueGrant(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  // 1. The backend owns the token; only its commitment is signed.
  const credential = createGrantCredential();

  const status = await runOwnerIntent(
    api,
    {
      type: "grant_issue",
      agent_id: agentId,
      label: "Example payout bot",
      credential: credential.commitment,
      // No permissions here: the account policy decides what every grant may do and where funds
      // may go (see 03:near-policy-provider), and editing it never requires a new grant.
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS" || status.type !== "grant_issue" || !status.details.grant)
    throw new Error(status.failure_code ?? `grant ${status.status}`);

  const grant = status.details.grant;
  await saveGrant({
    agent_id: agentId,
    grant_id: grant.grant_id,
    token: credential.token,
    label: grant.label,
    expires_at: grant.expires_at,
  });
  return {
    grant_id: grant.grant_id,
    label: grant.label,
    expires_at: grant.expires_at,
    // Keep this on the backend — it is the only copy. Shown here because this is an example.
    token: credential.token,
    next: "Run pnpm 04:delegate-client with this token to act under the grant.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("issuing a grant");
  banner(["Issuing an owner grant to a new token…"]);
  void issueGrant(required(config().agentId, "AGENT_ID")).then(print);
}
