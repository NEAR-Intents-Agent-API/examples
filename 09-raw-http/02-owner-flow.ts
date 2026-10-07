/**
 * The owner flow over raw HTTP.
 *
 * What: generate-intent → sign locally → submit-intent → status, with no SDK at all.
 * When: when your backend is not TypeScript, or to see exactly what the SDK sends.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 09:owner-flow`
 */

import type {
  AgentView,
  GenerateIntentResponse,
  StatusResponse,
} from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadOwner } from "../support/near-owner.js";
import { rawRequest } from "../support/raw-http.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** Long-polls `GET /v1/status` (`wait_ms` is capped at 30 000) until the intent stops moving. */
async function settle(correlationId: string, deadlineMs = 120_000): Promise<StatusResponse> {
  const deadline = Date.now() + deadlineMs;
  while (true) {
    const status = await rawRequest<StatusResponse>({
      path: `/v1/status?correlation_id=${encodeURIComponent(correlationId)}&wait_ms=30000`,
    });
    if (!["PROCESSING", "QUEUED"].includes(status.status) || Date.now() > deadline) return status;
  }
}

/** generate-intent → sign locally → submit-intent → status, for one owner action. */
async function ownerIntent(type: "agent_freeze" | "agent_unfreeze", agentId: string) {
  const { keyPair } = loadOwner();

  // 1. Build the owner intent. `Idempotency-Key` is optional here but always worth sending.
  const generated = await rawRequest<GenerateIntentResponse>({
    method: "POST",
    path: "/v1/generate-intent",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { type, agent_id: agentId },
  });

  // 2. Sign the payload exactly as returned. The wallet adapter is local to the owner.
  const signedData = await signNearIntent(generated, keyPair, config().nearRpcUrl);

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

  // 4. Follow the intent until it settles.
  const status = await settle(generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `${type} ${status.status}`);
  return { standard: generated.intent.standard, status };
}

export async function ownerFlowHttp(agentId: string) {
  // Unfreezes are 10 minutes apart: do not freeze an agent this example could not unfreeze.
  const agent = await rawRequest<AgentView>({ path: `/v1/agents/${encodeURIComponent(agentId)}` });
  const unfreezeAt = agent.cooldowns.unfreeze_available_at;
  if (unfreezeAt && Date.parse(unfreezeAt) > Date.now())
    throw new Error(`Unfreezing is throttled until ${unfreezeAt}; run this example after that.`);

  const freeze = await ownerIntent("agent_freeze", agentId);
  // Unfreeze again so the example is repeatable.
  const unfreeze = await ownerIntent("agent_unfreeze", agentId);
  return { freeze, unfreeze, headers: "X-API-Key only" };
}

if (isMainModule(import.meta.url)) {
  requireWrites("freezing an agent");
  banner(["Owner flow with plain fetch…"]);
  void ownerFlowHttp(required(config().agentId, "AGENT_ID")).then(print);
}
