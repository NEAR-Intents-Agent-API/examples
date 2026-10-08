import { setTimeout as sleep } from "node:timers/promises";
import type { AgentApi, StatusResponse } from "@near-intents-agent-api/sdk";

/**
 * Owner-intent and status plumbing shared by the examples.
 *
 * Two rules an integration must internalize:
 * - **Persist before you dispatch.** Save the generated intent (or at least its `correlation_id`)
 *   before asking the owner to sign, so an interrupted session can resume instead of rebuilding.
 * - **Never resubmit an uncertain operation.** Poll the original `correlation_id`; a new request
 *   with a fresh key can double-spend.
 */

/** Statuses that mean "still moving" — keep polling. */
const POLLING = new Set(["PROCESSING", "QUEUED"]);

/**
 * Polls until the operation stops moving. Stops on every terminal status, on
 * `PENDING_SIGNATURE`/`PENDING_APPROVAL`/`PENDING_DEPOSIT` (they need a human or external event),
 * and on `UNCERTAIN`/`NEEDS_REVIEW` (they need reconciliation, not more polling).
 */
export async function waitForStatus(
  api: AgentApi,
  correlationId: string,
  signal = AbortSignal.timeout(120_000),
): Promise<StatusResponse> {
  while (true) {
    signal.throwIfAborted();
    const status = await api.getStatus(correlationId, { waitMs: 30_000, signal });
    if (!POLLING.has(status.status)) return status;
  }
}

/**
 * The complete owner flow, from a request to a settled status:
 * generate → (persist) → sign → submit → poll. `sign` is where your wallet UI or backend adapter
 * goes; the examples pass a keypair signer, a browser passes the connected wallet.
 */
export async function runOwnerIntent(
  api: AgentApi,
  request: Parameters<AgentApi["generateIntent"]>[0],
  sign: (generated: Awaited<ReturnType<AgentApi["generateIntent"]>>) => Promise<unknown>,
  options: {
    idempotencyKey: string;
    save?: (generated: Awaited<ReturnType<AgentApi["generateIntent"]>>) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<StatusResponse> {
  const generated = await api.generateIntent(request, { idempotencyKey: options.idempotencyKey });
  await options.save?.(generated);
  const signedData = await sign(generated);
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: signedData as never,
  });
  return waitForStatus(api, generated.correlation_id, options.signal);
}

/**
 * Refuses to start a freeze demo that could not unfreeze again. Unfreezes are at least 10
 * minutes apart (`agent_unfreeze_throttled`), so freezing right after an unfreeze would leave the
 * account frozen until `cooldowns.unfreeze_available_at`.
 */
export async function assertCanUnfreeze(api: AgentApi, agentId: string) {
  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.unfreeze_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(
      `This agent was unfrozen less than 10 minutes ago; it could not be unfrozen again until ${availableAt}. Run this example after that.`,
    );
}

/** The agent id of a settled status, or an error naming the failure. */
export function settledAgentId(status: StatusResponse): string {
  if (status.agent_id === null)
    throw new Error(status.failure_code ?? `${status.type} has no agent`);
  return status.agent_id;
}

/** Builds a complete `policy_update` from the current revision: read, edit, keep the revision. */
export async function buildPolicyUpdate(
  api: AgentApi,
  agentId: string,
  edit: (
    policy: NonNullable<Awaited<ReturnType<AgentApi["getPolicy"]>>["policy"]>,
  ) => NonNullable<Awaited<ReturnType<AgentApi["getPolicy"]>>["policy"]>,
) {
  const current = await api.getPolicy(agentId);
  if (!current.policy || current.revision === null)
    throw new Error("Agent has no applied policy yet; wait for onboarding to finish");
  return {
    type: "policy_update" as const,
    agent_id: agentId,
    expected_revision: current.revision,
    policy: edit(current.policy),
  };
}

/**
 * Settles one delegated execution and follows it. Pass the promise from the action method
 * (`api.transfer(...)`, `api.swap(...)`, …). A `PENDING_APPROVAL` result is returned as-is so the
 * caller can cast the owner vote; polling would otherwise wait for something only the owner can
 * unblock.
 */
export async function settleExecution(
  api: AgentApi,
  execution: Promise<{ correlation_id: string; status: StatusResponse["status"] }>,
): Promise<StatusResponse> {
  const result = await execution;
  if (result.status === "PENDING_APPROVAL") return result as StatusResponse;
  return waitForStatus(api, result.correlation_id);
}

/**
 * Follows an execution after the owner voted on it. The vote settles first; the execution leaves
 * `PENDING_APPROVAL` once the wallet provider records it, then settles like any other.
 */
export async function settleApprovedExecution(
  api: AgentApi,
  correlationId: string,
  signal = AbortSignal.timeout(180_000),
): Promise<StatusResponse> {
  while (true) {
    const status = await waitForStatus(api, correlationId, signal);
    if (status.status !== "PENDING_APPROVAL") return status;
    await sleep(2_000, undefined, { signal });
  }
}
