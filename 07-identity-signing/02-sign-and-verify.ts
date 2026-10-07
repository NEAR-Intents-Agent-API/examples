/**
 * Prove the agent's identity to a service, and verify it as that service.
 *
 * What: plays both sides. The relying party issues a challenge; the agent's backend has the API
 *       sign it with the agent's key under a grant; the relying party verifies the NEP-413
 *       signature and that the key controls the agent's NEAR account.
 * When: an agent logs in to a service that identifies NEAR accounts by signature.
 * Needs: `AGENT_ID`, `AGENT_SIGN_RECIPIENT` listed in the policy (`07:enable-signing`), stored
 *        grant (`04:issue-grant`).
 * Run: `pnpm 07:sign-and-verify`
 *
 * Signing moves no money and changes no state, so it needs no `AGENT_ALLOW_WRITES`. It does need a
 * live grant: the API key alone is refused with `agent_grant_required`. Each call returns a fresh
 * random NEP-413 nonce; the relying party accepts each `challenge` value once and only before
 * `expires_at_ms` (at most 5 minutes after `issued_at_ms`).
 */
import type { AgentApi } from "../support/client.js";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { identityChallenge, verifyIdentitySignature } from "../support/identity.js";

/** The agent's backend: sign a challenge it received, under the grant it holds. */
export function signChallenge(
  delegate: AgentApi,
  agentId: string,
  input: { message: string; recipient: string },
) {
  // `encoding: "hex"` is also accepted when your transport cannot carry the JSON as text.
  return delegate.sign(agentId, { message: input.message, recipient: input.recipient });
}

export async function signAndVerify(agentId: string, recipient: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);

  // 1. Relying party: issue a challenge naming itself, and remember it.
  const issued = identityChallenge(recipient);

  // 2. Agent backend: ask the API to sign it with the agent's key.
  const signature = await signChallenge(api.forGrant(stored.token), agentId, {
    message: issued.message,
    recipient,
  });

  // 3. Relying party: verify the signature, the key and the account. Mark the challenge used.
  const { near_account_id } = await api.getWallet(agentId);
  const proven = await verifyIdentitySignature({
    issued,
    signature,
    rpcUrl: settings.nearRpcUrl,
    expectedAccountId: near_account_id,
  });

  return {
    challenge: issued.challenge,
    signature,
    verified: proven,
    note: "The relying party now knows this request comes from the agent's NEAR account.",
  };
}

if (isMainModule(import.meta.url)) {
  const settings = config();
  const recipient = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([`Signing an identity challenge for ${recipient} and verifying it…`]);
  void signAndVerify(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
