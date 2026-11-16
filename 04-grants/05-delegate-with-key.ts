/**
 * Act through a key-bound grant, by session and by proof.
 *
 * What: loads the key from `04:issue-key-grant` and previews a withdrawal twice: once under a
 *       session (`forGrantSession`) and once with a signed proof per request (`forGrantProof`).
 * When: this is the client a server holding its own key runs. No grant token exists anywhere.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`, `AGENT_RECIPIENT`; the stored key grant.
 * Run: `pnpm 04:delegate-with-key`
 *
 * - **Session**: the key signs a one-minute assertion, the API trades it for an `ngs_` token that
 *   lives 15 minutes, and the client keeps it and exchanges again in the background shortly before
 *   it ends. One signature covers the whole session, so choose it when the key is slow or billed per use (a
 *   cloud KMS) or the workload sends many requests.
 * - **Proof**: the key signs every request (grant, method, URL, exact body, `Idempotency-Key`) and
 *   the client sends it as `X-Grant-Proof`. No bearer token exists, in memory, in logs or on the
 *   wire. A retry signs a new proof and repeats the same `Idempotency-Key`.
 *
 * A withdrawal preview needs a grant, so it proves the key is accepted, but moves nothing. It
 * counts toward the wallet's daily custody operations, like any preview. `baseUrl` must be the
 * URL the API publishes (the hosted API's, as in `.env.example`): audiences are built from it.
 */

import { localJwkSigner } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadKeyGrant } from "../support/grant-store.js";

export async function useKeyGrant(agentId: string) {
  const settings = config();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const api = agentApi();
  const stored = await loadKeyGrant(agentId);
  const signer = localJwkSigner(stored.private_jwk);
  const preview = {
    asset: settings.token,
    amount: settings.transferAmount,
    chain: "near",
    recipient,
    dry: true,
  } as const;

  // (a) Session: the first delegated call exchanges; later calls reuse the `ngs_` token.
  const viaSession = api.forGrantSession(agentId, { signer, grantId: stored.grant_id });
  const session = await viaSession.withdraw(agentId, preview);

  // (b) Proof: every call signs its own request. `grantId` is the one returned at issuance.
  const viaProof = api.forGrantProof({ grantId: stored.grant_id, signer });
  const proof = await viaProof.withdraw(agentId, preview);

  return {
    grant: { grant_id: stored.grant_id, label: stored.label, expires_at: stored.expires_at },
    session: { quote: session.quote, warnings: session.warnings },
    proof: { quote: proof.quote, warnings: proof.warnings },
    note: "Previews only: nothing moved. Both clients were authorized by the key, not by a token.",
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Previewing a withdrawal under a key-bound grant, by session and by proof…"]);
  void useKeyGrant(required(config().agentId, "AGENT_ID")).then(print);
}
