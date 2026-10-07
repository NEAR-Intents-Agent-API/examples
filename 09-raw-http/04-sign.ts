/**
 * Identity signing over raw HTTP.
 *
 * What: posts a canonical identity challenge to `/v1/agents/{agent_id}/sign` with
 *       `X-Grant-Token`, then verifies the returned NEP-413 signature.
 * When: your backend is not TypeScript, or you want to see the exact wire shape.
 * Needs: `AGENT_ID`, `AGENT_SIGN_RECIPIENT` listed in the policy (`07:enable-signing`), stored
 *        grant (`04:issue-grant`).
 * Run: `pnpm 09:sign`
 *
 * No `Idempotency-Key`: a signature changes no state, and each call returns a fresh nonce. The
 * grant token is required; the API key alone is refused with `agent_grant_required`.
 */
import type { Signature, WalletView } from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { identityChallenge, verifyIdentitySignature } from "../support/identity.js";
import { rawRequest } from "../support/raw-http.js";

export async function signHttp(agentId: string, recipient: string) {
  const settings = config();
  const stored = await loadGrant(agentId);
  // `message` is the challenge as canonical JSON: keys sorted, no whitespace.
  const issued = identityChallenge(recipient);

  const signature = await rawRequest<Signature>({
    method: "POST",
    path: `/v1/agents/${agentId}/sign`,
    headers: { "X-Grant-Token": stored.token },
    body: { message: issued.message, recipient },
  });
  const wallet = await rawRequest<WalletView>({ path: `/v1/agents/${agentId}/wallet` });
  return {
    request: { message: issued.message, recipient },
    signature,
    verified: await verifyIdentitySignature({
      issued,
      signature,
      rpcUrl: settings.nearRpcUrl,
      expectedAccountId: wallet.near_account_id,
    }),
  };
}

if (isMainModule(import.meta.url)) {
  const settings = config();
  const recipient = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([`Signing an identity challenge for ${recipient} with plain fetch…`]);
  void signHttp(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
