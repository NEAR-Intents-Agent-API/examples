/**
 * Limit money actions to the owner's working hours.
 *
 * What: adds `schedule` (Mon–Fri 09:00–17:00 on the owner's clock) to the policy with one
 *       off-chain signature, then shows how a refused action reports when it may run again.
 * When: an owner wants the agent to move money only while someone is around to watch, or to
 *       pause it overnight (`mode: "except"`).
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`. With `AGENT_EXECUTE=true` it also
 *        tries a transfer (`AGENT_RECIPIENT`, stored grant), which runs if the schedule is open.
 * Run: `pnpm 06:schedule`
 *
 * The API enforces the schedule itself, so the edit is signed `nep413` (`eip712` for EVM owners)
 * and sends no blockchain transaction. An action is judged when it would run: at submit for now
 * plus `timelock_ms`, again when a timelock releases, and again at dispatch. Outside the schedule
 * the API answers `403 policy_schedule_denied` with `meta.available_at`, the next moment it
 * opens. Nothing was sent: submit again at that time with a **new** idempotency key. Deposits,
 * message signing and owner approval votes are never held.
 *
 * Policy changes are at least 10 minutes apart, so a schedule already on the policy is kept.
 * Remove it with a `policy_update` that omits `schedule`.
 */
import { AgentApiError, type Schedule } from "@near-intents-agent-api/sdk";
import { type AgentApi, agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/**
 * Weekly windows in an IANA time zone. `start` is inclusive and `end` exclusive; an `end` earlier
 * than `start` runs past midnight and belongs to its start day, and `24:00` closes the day.
 */
function businessHours(timeZone: string): Schedule {
  return {
    mode: "only",
    time_zone: timeZone,
    windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "17:00" }],
  };
}

/** Pause overnight instead: every day from 22:00 until 07:00 the next morning. */
export const overnightPause = (timeZone: string): Schedule => ({
  mode: "except",
  time_zone: timeZone,
  windows: [
    {
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      start: "22:00",
      end: "07:00",
    },
  ],
});

/**
 * Runs one delegated action, turning a schedule refusal into "held until". Any other error is
 * your normal error handling.
 */
export async function withinSchedule<T>(run: () => Promise<T>) {
  try {
    return { held: false as const, result: await run() };
  } catch (error) {
    if (error instanceof AgentApiError && error.code === "policy_schedule_denied")
      return { held: true as const, available_at: error.availableAt, detail: error.detail };
    throw error;
  }
}

async function applySchedule(api: AgentApi, agentId: string, schedule: Schedule) {
  const settings = config();
  const { keyPair } = loadOwner();
  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(
      `Policy changes are throttled until ${availableAt}; run this example after that.`,
    );

  // The complete policy with only `schedule` added.
  const request = await buildPolicyUpdate(api, agentId, (policy) => ({ ...policy, schedule }));
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);
  return {
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
  };
}

async function tryTransfer(api: AgentApi, agentId: string) {
  requireWrites("trying a scheduled transfer");
  const settings = config();
  const stored = await loadGrant(agentId);
  return withinSchedule(() =>
    api.forGrant(stored.token).transfer(
      agentId,
      {
        asset: settings.token,
        amount: settings.transferAmount,
        recipient: required(settings.recipient, "AGENT_RECIPIENT"),
      },
      { idempotencyKey: crypto.randomUUID() },
    ),
  );
}

export async function scheduleMoneyActions(agentId: string) {
  const settings = config();
  const api = agentApi();

  // 1. Sign business hours in the owner's time zone, unless a schedule is already set.
  const current = await api.getPolicy(agentId);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const applied = current.policy?.schedule
    ? null
    : await applySchedule(api, agentId, businessHours(timeZone));
  const policy = await api.getPolicy(agentId);

  // 2. A delegated action outside the schedule is refused with the time it may run.
  const attempt = settings.execute
    ? await tryTransfer(api, agentId)
    : { skipped: "Set AGENT_EXECUTE=true to try a transfer against the schedule." };

  return {
    applied: applied ?? "kept the schedule already on the policy",
    revision: policy.revision,
    status: policy.status,
    schedule: policy.policy?.schedule,
    timelock_ms: policy.policy?.timelock_ms,
    attempt,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  banner(["Limiting money actions to weekday business hours…"]);
  void scheduleMoneyActions(required(config().agentId, "AGENT_ID")).then(print);
}
