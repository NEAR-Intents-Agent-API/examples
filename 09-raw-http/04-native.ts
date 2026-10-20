/**
 * A native method over raw HTTP: NEP-413 message signing with the agent's NEAR key.
 *
 * What: posts a login message, recipient and nonce to `/v1/agents/{agent_id}/native/near/sign-message` with
 *       `X-Grant-Token`, then verifies the returned NEP-413 signature.
 * When: your backend is not TypeScript, or you want to see the exact wire shape.
 * Needs: `AGENT_ID`, `AGENT_SIGN_RECIPIENT` in `native.near.sign_message` (`07:enable-native`),
 *        stored grant (`04:issue-grant`).
 * Run: `pnpm 09:native`
 *
 * No `Idempotency-Key`: a signature moves nothing, and the caller supplies the nonce. The other
 * signing routes (`native/evm/…`, `native/solana/…`) take the same headers; only
 * `native/near/transfer` and `native/near/call` need an `Idempotency-Key`. The grant token is
 * required; the API key alone is refused with `agent_grant_required`.
 */
import type { Signature, WalletView } from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { loginRequest, verifyLogin } from "../support/identity.js";
import { rawRequest } from "../support/raw-http.js";

export async function signHttp(agentId: string, recipient: string) {
  const settings = config();
  const stored = await loadGrant(agentId);
  const issued = loginRequest(recipient);

  const signature = await rawRequest<Signature>({
    method: "POST",
    path: `/v1/agents/${agentId}/native/near/sign-message`,
    headers: { "X-Grant-Token": stored.token },
    body: { message: issued.message, recipient, nonce: issued.nonce },
  });
  const wallet = await rawRequest<WalletView>({ path: `/v1/agents/${agentId}/wallet` });
  return {
    request: issued,
    signature,
    verified: await verifyLogin({
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
  banner([`Signing a NEP-413 login for ${recipient} with plain fetch…`]);
  void signHttp(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
