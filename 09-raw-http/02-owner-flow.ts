/**
 * The owner flow over raw HTTP.
 *
 * What: generate-intent → sign locally → submit-intent → status, with no SDK at all.
 * When: when your backend is not TypeScript, or to see exactly what the SDK sends.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 09:owner-flow`
 */

import type { GenerateIntentResponse, StatusResponse } from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadOwner } from "../support/near-owner.js";
import { rawRequest } from "../support/raw-http.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function ownerFlowHttp(agentId: string) {
  const settings = config();
  const { keyPair } = loadOwner();
  const idempotencyKey = crypto.randomUUID();

  // 1. Build the owner intent. `Idempotency-Key` is optional here but always worth sending.
  const generated = await rawRequest<GenerateIntentResponse>({
    method: "POST",
    path: "/v1/generate-intent",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { type: "agent_freeze", agent_id: agentId },
  });

  // 2. Sign the payload exactly as returned. The wallet adapter is local to the owner.
  const signedData = await signNearIntent(generated, keyPair, settings.nearRpcUrl);

  // 3. Submit the wallet output.
  await rawRequest<StatusResponse>({
    method: "POST",
    path: "/v1/submit-intent",
    body: {
      type: generated.type,
      correlation_id: generated.correlation_id,
      signed_data: signedData,
    },
  });

  // 4. Long-poll status. `wait_ms` is capped at 30 000.
  const status = await rawRequest<StatusResponse>({
    path: `/v1/status?correlation_id=${encodeURIComponent(generated.correlation_id)}&wait_ms=30000`,
  });

  // Unfreeze again so the example is repeatable.
  const unfreeze = await rawRequest<GenerateIntentResponse>({
    method: "POST",
    path: "/v1/generate-intent",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { type: "agent_unfreeze", agent_id: agentId },
  });
  await rawRequest<StatusResponse>({
    method: "POST",
    path: "/v1/submit-intent",
    body: {
      type: unfreeze.type,
      correlation_id: unfreeze.correlation_id,
      signed_data: await signNearIntent(unfreeze, keyPair, settings.nearRpcUrl),
    },
  });
  return { standard: generated.intent.standard, status, headers: "X-API-Key only" };
}

if (isMainModule(import.meta.url)) {
  requireWrites("freezing an agent");
  banner(["Owner flow with plain fetch…"]);
  void ownerFlowHttp(required(config().agentId, "AGENT_ID")).then(print);
}
