/**
 * A delegated execution over raw HTTP.
 *
 * What: calls transfer with `X-Grant-Token` and `Idempotency-Key`, then polls status.
 * When: to see the exact headers a spend requires, or from a non-TypeScript backend.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, `AGENT_RECIPIENT`, stored grant.
 * Run: `pnpm 09:execution`
 *
 * A spend requires both headers: the grant token says *who* is acting (the policy decides what
 * they may do), the idempotency key names *this* logical request. The API key alone authorizes nothing.
 */

import type { StatusResponse } from "@near-intents-agent-api/sdk";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { rawRequest } from "../support/raw-http.js";

export async function executionHttp(agentId: string) {
  const settings = config();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);

  const execution = await rawRequest<StatusResponse>({
    method: "POST",
    path: `/v1/agents/${agentId}/transfer`,
    headers: {
      "X-Grant-Token": stored.token,
      "Idempotency-Key": `example-http-${crypto.randomUUID()}`,
    },
    body: { asset: settings.token, amount: settings.transferAmount, recipient },
  });
  let status = execution;
  for (
    let attempt = 0;
    attempt < 10 && ["PROCESSING", "QUEUED"].includes(status.status);
    attempt++
  ) {
    status = await rawRequest<StatusResponse>({
      path: `/v1/status?correlation_id=${encodeURIComponent(execution.correlation_id)}&wait_ms=30000`,
    });
  }
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    grant: status.grant,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("executing a transfer");
  banner(["Delegated execution with plain fetch…"]);
  void executionHttp(required(config().agentId, "AGENT_ID")).then(print);
}
