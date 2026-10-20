/**
 * Log the agent in to a service with a NEP-413 signature, and verify it as that service.
 *
 * What: plays both sides. The relying party issues a message and a nonce; the agent's backend has
 *       the API sign them (NEP-413) with the agent's key under a grant; the relying party verifies
 *       the signature, the nonce and that the key controls the agent's NEAR account.
 * When: an agent logs in to a service that identifies NEAR accounts by signature.
 * Needs: `AGENT_ID`, `AGENT_SIGN_RECIPIENT` in `native.near.sign_message` (`07:enable-native`),
 *        stored grant (`04:issue-grant`).
 * Run: `pnpm 07:sign-and-verify`
 *
 * Signing moves no money, so it needs no `AGENT_ALLOW_WRITES`; each signature is recorded in the
 * agent's history as type `native`. It does need a live grant: the API key alone is refused with
 * `agent_grant_required`. The nonce is the relying party's: 32 random bytes, base64, accepted once.
 */
import type { AgentApi } from "../support/client.js";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { loginRequest, verifyLogin } from "../support/identity.js";

/** The agent's backend: sign a login request it received, under the grant it holds. */
export function signLogin(
  delegate: AgentApi,
  agentId: string,
  input: { message: string; recipient: string; nonce: string },
) {
  // `encoding: "hex"` is also accepted when the message is raw bytes.
  return delegate.nativeNearSignMessage(agentId, input);
}

export async function signAndVerify(agentId: string, recipient: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);

  // 1. Relying party: issue a login request naming itself, and remember the nonce.
  const issued = loginRequest(recipient);

  // 2. Agent backend: ask the API to sign it with the agent's key.
  const signature = await signLogin(api.forGrant(stored.token), agentId, {
    message: issued.message,
    recipient,
    nonce: issued.nonce,
  });

  // 3. Relying party: verify the signature, the nonce, the key and the account. verifyLogin does not
  //    remember nonces: a real relying party records each nonce as used to refuse replays.
  const { near_account_id } = await api.getWallet(agentId);
  const proven = await verifyLogin({
    issued,
    signature,
    rpcUrl: settings.nearRpcUrl,
    expectedAccountId: near_account_id,
  });

  return {
    request: issued,
    signature,
    verified: proven,
    note: "The relying party now knows this request comes from the agent's NEAR account.",
  };
}

if (isMainModule(import.meta.url)) {
  const settings = config();
  const recipient = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([`Signing a NEP-413 login for ${recipient} and verifying it…`]);
  void signAndVerify(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
