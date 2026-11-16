/**
 * Issue a grant bound to a key the workload holds.
 *
 * What: generates an Ed25519 key, has the owner sign a `public_key` grant over its public half, and
 *       keeps the private key and the issued `grant_id` for `04:delegate-with-key`.
 * When: a server, VPS or laptop with no identity provider that should hold no long-lived token.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 04:issue-key-grant`
 *
 * The workload keeps the private key; only the public JWK reaches the owner and the API. The API
 * never sees a token: the key signs a short-lived assertion for a session, or a proof for each
 * request. Everything else about the grant is as for `04:issue-grant`: no permissions of its own,
 * and the account policy decides what it may do. Use `createWorkloadKey("P-256")` for a key that a
 * TPM, HSM or cloud KMS can hold (`04:kms-signer`).
 */

import { createWorkloadKey, jwkThumbprintUri } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent } from "../support/flow.js";
import { saveKeyGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function issueKeyGrant(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  // 1. The workload owns the key. In production this runs where the key will live.
  const { privateJwk, publicJwk } = createWorkloadKey("Ed25519");

  // 2. The owner signs the binding to the public key. `grant_issue` carries the JWK itself, so
  //    the owner sees exactly which key will be able to act.
  const status = await runOwnerIntent(
    api,
    {
      type: "grant_issue",
      agent_id: agentId,
      label: "Example server (key)",
      credential: { type: "public_key", jwk: publicJwk },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS" || status.type !== "grant_issue" || !status.details.grant)
    throw new Error(status.failure_code ?? `grant ${status.status}`);

  // 3. The `grant_id` comes from the issued grant. Proofs name it, so keep it with the key.
  const grant = status.details.grant;
  await saveKeyGrant({
    agent_id: agentId,
    grant_id: grant.grant_id,
    label: grant.label,
    expires_at: grant.expires_at,
    private_jwk: privateJwk,
  });
  return {
    grant_id: grant.grant_id,
    label: grant.label,
    expires_at: grant.expires_at,
    credential_type: grant.credential_type,
    key: jwkThumbprintUri(publicJwk),
    next: "Run pnpm 04:delegate-with-key to act under the grant with the stored key.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("issuing a key-bound grant");
  banner(["Issuing a grant bound to a new workload key…"]);
  void issueKeyGrant(required(config().agentId, "AGENT_ID")).then(print);
}
