/**
 * Sign every request with `X-Grant-Proof` over raw HTTP.
 *
 * What: builds a proof by hand for one withdrawal preview and sends it in place of a grant token.
 * When: to see what a proof binds, or from a workload that must hold no bearer token at all.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`, `AGENT_RECIPIENT`; the stored key grant from
 *        `pnpm 04:issue-key-grant`.
 * Run: `pnpm 09:grant-proof`
 *
 * The proof is a JWT the key signs for exactly this request: the grant (`grant_id`, as returned
 * when it was issued), the method, the URL without query, the SHA-256 of the exact body bytes and
 * the `Idempotency-Key` as sent. Serialize the body once, hash that text and send the same text
 * (`bodyText`). The API spends the `jti` on first use: a retry signs a new proof and repeats the
 * same `Idempotency-Key`. Send either `X-Grant-Proof` or `X-Grant-Token`, never both
 * (`validation_failed`). `X-API-Key` is still required.
 */

import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadKeyGrant } from "../support/grant-store.js";
import { rawRequest } from "../support/raw-http.js";
import { bodySha256, signJwt, workloadClaims } from "../support/raw-workload.js";

export async function grantProofHttp(agentId: string) {
  const settings = config();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadKeyGrant(agentId);

  const path = `/v1/agents/${agentId}/withdraw`;
  const idempotencyKey = `example-http-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    asset: settings.token,
    amount: settings.transferAmount,
    chain: "near",
    recipient,
    dry: true,
  });

  const proof = signJwt(stored.private_jwk, {
    ...workloadClaims(stored.private_jwk, `${settings.apiUrl}${path}`),
    grant_id: stored.grant_id,
    htm: "POST",
    body_sha256: bodySha256(body),
    idempotency_key: idempotencyKey,
  });

  const preview = await rawRequest<Record<string, unknown>>({
    method: "POST",
    path,
    headers: { "X-Grant-Proof": proof, "Idempotency-Key": idempotencyKey },
    bodyText: body,
  });
  return { grant_id: stored.grant_id, preview };
}

if (isMainModule(import.meta.url)) {
  banner(["Raw HTTP: a withdrawal preview signed with X-Grant-Proof…"]);
  void grantProofHttp(required(config().agentId, "AGENT_ID")).then(print);
}
