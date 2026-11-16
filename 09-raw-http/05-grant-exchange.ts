/**
 * Exchange a key assertion for a session over raw HTTP.
 *
 * What: signs an RFC 7523 assertion by hand, trades it at `/grants/token` for an `ngs_` session
 *       token (RFC 8693), then previews a withdrawal with the session in `X-Grant-Token`.
 * When: to see the exact exchange on the wire, or from a non-TypeScript workload.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`, `AGENT_RECIPIENT`; the stored key grant from
 *        `pnpm 04:issue-key-grant`.
 * Run: `pnpm 09:grant-exchange`
 *
 * The assertion is a JWT the key signs: `iss` and `sub` are the key's thumbprint URI, `aud` is the
 * exchange URL, `exp` at most five minutes after `iat`, and a unique `jti` that exchanges once, so
 * sign a new one for every exchange. The API key is still sent: federation replaces the grant
 * token, not the partner key. An OIDC grant exchanges the platform's identity token the same way:
 * only `subject_token` differs. The session lives 15 minutes by default; exchange again before
 * `expires_at`, not on every request.
 */

import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadKeyGrant } from "../support/grant-store.js";
import { rawRequest } from "../support/raw-http.js";
import { signJwt, workloadClaims } from "../support/raw-workload.js";

type Exchange = {
  access_token: string;
  expires_in: number;
  expires_at: string;
  grant_id: string;
  label: string;
};

export async function grantExchangeHttp(agentId: string) {
  const settings = config();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadKeyGrant(agentId);

  const path = `/v1/agents/${agentId}/grants/token`;
  const assertion = signJwt(
    stored.private_jwk,
    workloadClaims(stored.private_jwk, `${settings.apiUrl}${path}`),
  );

  const exchange = await rawRequest<Exchange>({
    method: "POST",
    path,
    body: {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: assertion,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      // Only needed when the key matches more than one live grant on the agent.
      grant_id: stored.grant_id,
    },
  });

  // The session goes where a grant token goes.
  const preview = await rawRequest<Record<string, unknown>>({
    method: "POST",
    path: `/v1/agents/${agentId}/withdraw`,
    headers: {
      "X-Grant-Token": exchange.access_token,
      "Idempotency-Key": `example-http-${crypto.randomUUID()}`,
    },
    body: {
      asset: settings.token,
      amount: settings.transferAmount,
      chain: "near",
      recipient,
      dry: true,
    },
  });
  return {
    session: {
      grant_id: exchange.grant_id,
      label: exchange.label,
      expires_in: exchange.expires_in,
      expires_at: exchange.expires_at,
    },
    preview,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Raw HTTP: exchanging a key assertion for a session…"]);
  void grantExchangeHttp(required(config().agentId, "AGENT_ID")).then(print);
}
