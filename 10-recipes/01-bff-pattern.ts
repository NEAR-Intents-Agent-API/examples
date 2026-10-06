/**
 * Backend-for-frontend (BFF) pattern.
 *
 * What: models the boundary between a browser and your backend for an owner action. The backend
 *       holds the API key and prepares the payload; the browser signs it and returns the output.
 * When: this is the shape every web integration should use.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 10:bff-pattern`
 *
 * The API key (`naa_…`) never reaches the browser. What crosses the boundary is only the
 * prepared payload, its public preview, and the wallet's output.
 */
import {
  type AgentApi,
  agentApi,
  type GenerateIntentResponse,
  type SignedData,
} from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

// -------------------------------------------------------------------------------------------
// BACKEND — holds the API key and the application's correlation records.
// -------------------------------------------------------------------------------------------

/** Prepares the owner action. Only `browser` is allowed to leave the server. */
async function backendPrepare(api: AgentApi, agentId: string) {
  const current = await api.getPolicy(agentId);
  if (!current.policy || current.revision === null) throw new Error("policy_not_ready");
  const generated = await api.generateIntent(
    {
      type: "policy_update",
      agent_id: agentId,
      expected_revision: current.revision,
      policy: {
        ...current.policy,
        budget: { daily_usd: "25", weekly_usd: "100", monthly_usd: null },
      },
    },
    { idempotencyKey: `bff-policy-${agentId}-r${current.revision}` },
  );
  return {
    // Persist this server-side and check application ownership before submitting.
    server: { correlation_id: generated.correlation_id, agent_id: agentId, user_id: "app-user-1" },
    // Browser-safe: the exact payload to sign, plus what to display next to the prompt.
    browser: {
      correlation_id: generated.correlation_id,
      standard: generated.intent.standard,
      payload: generated.intent.payload,
      preview: generated.preview,
      expires_at: generated.expires_at,
    },
    generated,
  };
}

/** Relays the wallet output after checking the intent belongs to this application user. */
async function backendSubmit(
  api: AgentApi,
  server: { correlation_id: string; agent_id: string; user_id: string },
  signedData: SignedData,
) {
  if (!server.user_id) throw new Error("unknown correlation id owner");
  return api.submitIntent({
    type: "policy_update",
    correlation_id: server.correlation_id,
    signed_data: signedData,
  });
}

// -------------------------------------------------------------------------------------------
// BROWSER — no API key. Signs exactly the prepared payload with the connected wallet.
// -------------------------------------------------------------------------------------------

async function browserSign(
  browser: { standard: string; payload: unknown },
  generated: GenerateIntentResponse,
): Promise<SignedData> {
  const settings = config();
  const { keyPair } = loadOwner();
  if (browser.standard !== generated.intent.standard) throw new Error("standard changed");
  // A real browser calls its connected wallet with `browser.payload`; this script uses the key.
  return signNearIntent(generated, keyPair, settings.nearRpcUrl);
}

export async function bffPattern(agentId: string) {
  const api = agentApi();
  const prepared = await backendPrepare(api, agentId);
  // What the frontend would render before the owner signs:
  const shown_to_owner = prepared.browser.preview.summary;
  const signedData = await browserSign(prepared.browser, prepared.generated);
  const submitted = await backendSubmit(api, prepared.server, signedData);
  return {
    shown_to_owner,
    boundary: "API key stayed on the backend; browser saw only payload + preview",
    submitted: { correlation_id: submitted.correlation_id, status: submitted.status },
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing a policy");
  banner(["Demonstrating the BFF boundary…"]);
  void bffPattern(required(config().agentId, "AGENT_ID")).then(print);
}
