/**
 * Timelocked payout with cancellation.
 *
 * What: sets an execution delay (`timelock_ms`), queues a transfer, shows it in the scheduled list, and cancels
 *       it before release.
 * When: when the owner wants a window to react before money leaves (e.g. treasury payouts).
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_RECIPIENT`, stored grant.
 * Run: `pnpm 10:timelocked-payout`
 *
 * The delay postpones work rather than refusing it. A queued execution reserves no USD budget;
 * the charge is decided when it dispatches. Editing the policy invalidates queued work admitted
 * under the previous revision.
 *
 * Policy changes are at least 10 minutes apart (`policy_change_throttled`), so this example sets
 * the delay once and leaves it: rerunning reuses the existing delay, and you remove it later with
 * `pnpm 06:edit-policy` (or a `policy_update` with `timelock_ms: 0`) once
 * `cooldowns.policy_change_available_at` has passed.
 */
import { type AgentApi, agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

async function ownerControl(
  api: AgentApi,
  request: Parameters<AgentApi["generateIntent"]>[0],
  keyPair: ReturnType<typeof loadOwner>["keyPair"],
  rpcUrl: string,
) {
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, rpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS") throw new Error(status.failure_code ?? status.status);
  return status;
}

export async function timelockedPayout(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const { keyPair } = loadOwner();
  const stored = await loadGrant(agentId);

  // 1. Add a 60-second (60 000 ms) delay to every money action, unless one is already set.
  const current = await api.getPolicy(agentId);
  const delayMs = current.policy?.timelock_ms ?? 0;
  if (delayMs === 0) {
    const { cooldowns } = await api.getAgent(agentId);
    const availableAt = cooldowns.policy_change_available_at;
    if (availableAt && Date.parse(availableAt) > Date.now())
      throw new Error(
        `Policy changes are throttled until ${availableAt}; run this example after that.`,
      );
    await ownerControl(
      api,
      await buildPolicyUpdate(api, agentId, (policy) => ({ ...policy, timelock_ms: 60_000 })),
      keyPair,
      settings.nearRpcUrl,
    );
  }

  // 2. Queue a transfer. It is accepted immediately but must wait for release.
  const queued = await api
    .forGrant(stored.token)
    .transfer(
      agentId,
      { asset: settings.token, amount: settings.transferAmount, recipient },
      { idempotencyKey: `timelocked-${crypto.randomUUID()}` },
    );

  // 3. Inspect the scheduler: earliest release first.
  const scheduled = await api.listScheduledExecutions(agentId, { limit: 10 });

  // 4. Cancel it (owner-signed). Queued work is never cancelled by editing a grant.
  const cancellation = await ownerControl(
    api,
    { type: "execution_cancel", agent_id: agentId, correlation_id: queued.correlation_id },
    keyPair,
    settings.nearRpcUrl,
  );

  return {
    queued: { correlation_id: queued.correlation_id, status: queued.status },
    scheduled_count: scheduled.data.length,
    scheduled: scheduled.data.map((entry) => ({
      correlation_id: entry.correlation_id,
      execute_after: entry.execute_after,
      state: entry.state,
    })),
    cancellation:
      cancellation.type === "execution_cancel"
        ? cancellation.details.cancelled_correlation_id
        : queued.correlation_id,
    timelock_ms: delayMs === 0 ? 60_000 : delayMs,
    note: "Queued work was cancelled, not executed. The delay stays on the policy; remove it with 06:edit-policy after the policy cooldown.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("queueing and cancelling a timelocked transfer");
  banner(["Queueing a timelocked payout and cancelling it…"]);
  void timelockedPayout(required(config().agentId, "AGENT_ID")).then(print);
}
