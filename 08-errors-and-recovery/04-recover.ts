/**
 * Recover an UNCERTAIN execution that provably never reached the provider.
 *
 * What: reads the execution record your backend saved before dispatch, checks the three facts
 *       that make recovery legal, and only then calls `recover` with the original body, key and
 *       grant. Otherwise it says why it keeps observing instead.
 * When: an execution is `UNCERTAIN` (the API lost track mid-dispatch) and you need to know whether
 *       it may be dispatched for the first time.
 * Needs: `AGENT_ALLOW_WRITES=true`, a saved execution record (JSON file path as argv[2]), and the
 *        stored grant that admitted it (`04:issue-grant`).
 * Run: `pnpm 08:recover .intents/pending/op_….json`
 *
 * Recovery is legal only when all hold:
 * 1. `status` is `UNCERTAIN`;
 * 2. `dispatch_committed_at` is null: the API never committed to the provider write;
 * 3. `details.provider_request_id` is absent: the provider never acknowledged a request.
 * The API checks the same facts and answers `409 operation_not_recoverable` otherwise, so this is
 * never a way past uncertainty. It also requires the same API key, the original `Idempotency-Key`,
 * an identical `request` (`idempotency_conflict` otherwise) and the grant that admitted it.
 * Cross-chain deposits are never recoverable.
 */
import { readFile } from "node:fs/promises";
import type { RecoverRequest, StatusResponse } from "@near-intents-agent-api/sdk";
import { type AgentApi, agentApi } from "../support/client.js";
import { banner, isMainModule, print, requireWrites } from "../support/config.js";
import { waitForStatus } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

/** What your backend persists before it sends an execution (see `03-idempotency.ts`). */
export type ExecutionRecord = {
  agent_id: string;
  correlation_id: string;
  idempotency_key: string;
  /** The exact body you sent, with its action as `type`: `swap`, `transfer`, `withdraw`, … */
  request: RecoverRequest["request"];
};

/** Why an execution may not be recovered, or null when it may. */
export function notRecoverableBecause(status: StatusResponse): string | null {
  if (status.status !== "UNCERTAIN")
    return `status is ${status.status}; recovery applies only to UNCERTAIN`;
  if (status.dispatch_committed_at !== null)
    return "the API committed to the provider write; it may have executed, keep observing";
  const details = status.details as { provider_request_id?: string | null };
  if (details.provider_request_id)
    return "the provider acknowledged a request; it may have executed, keep observing";
  return null;
}

export async function recoverExecution(api: AgentApi, record: ExecutionRecord) {
  const status = await api.getStatus(record.correlation_id);
  const reason = notRecoverableBecause(status);
  if (reason)
    return {
      recovered: false,
      status: status.status,
      reason,
      next: "Poll the same correlation_id; never send the request again with a new key.",
    };

  // Only the grant that admitted the execution may recover it.
  const stored = await loadGrant(record.agent_id);
  if (status.grant && status.grant.id !== stored.grant_id)
    throw new Error(`Admitted by grant ${status.grant.id}; the stored grant is ${stored.grant_id}`);

  const recovered = await api
    .forGrant(stored.token)
    .recover(
      record.agent_id,
      { correlation_id: record.correlation_id, request: record.request },
      { idempotencyKey: record.idempotency_key },
    );
  const settled = await waitForStatus(api, recovered.correlation_id);
  return {
    recovered: true,
    correlation_id: settled.correlation_id,
    status: settled.status,
    failure_code: settled.failure_code,
  };
}

if (isMainModule(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    print({
      usage: "pnpm 08:recover <execution-record.json>",
      record_shape: {
        agent_id: "…",
        correlation_id: "op_…",
        idempotency_key: "the key you sent",
        request: { type: "transfer", asset: "nep141:wrap.near", amount: "1", recipient: "…" },
      },
    });
  } else {
    requireWrites("recovering an execution");
    const record = JSON.parse(await readFile(path, "utf8")) as ExecutionRecord;
    banner([`Checking whether ${record.correlation_id} may be recovered…`]);
    void recoverExecution(agentApi(), record).then(print);
  }
}
