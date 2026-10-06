/**
 * Freeze and unfreeze an agent (emergency stop).
 *
 * What: freezes the account, proves that executions are refused, then unfreezes it.
 * When: an incident, a lost grant, or any reason to stop all spending immediately.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 06:freeze`
 *
 * Freeze is the strongest account-level stop: every grant and every caller is refused with
 * `wallet_frozen` until the owner unfreezes. Freeze itself bypasses the policy cooldown;
 * unfreeze has an independent one. Redundant freeze/unfreeze returns
 * `wallet_already_frozen` / `wallet_already_unfrozen`.
 */
import { type AgentApi, agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { waitForStatus } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

async function control(
  api: AgentApi,
  agentId: string,
  type: "agent_freeze" | "agent_unfreeze",
  keyPair: ReturnType<typeof loadOwner>["keyPair"],
  rpcUrl: string,
) {
  const generated = await api.generateIntent(
    { type, agent_id: agentId },
    { idempotencyKey: crypto.randomUUID() },
  );
  await api.submitIntent({
    type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, rpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `${type} ${status.status}`);
  return status;
}

export async function freezeAndUnfreeze(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();
  const stored = await loadGrant(agentId);

  const frozen = await control(api, agentId, "agent_freeze", keyPair, settings.nearRpcUrl);
  let refusal: string | null = null;
  try {
    await api.forGrant(stored.token).transfer(
      agentId,
      {
        asset: settings.token,
        amount: settings.transferAmount,
        recipient: required(settings.recipient, "AGENT_RECIPIENT"),
      },
      { idempotencyKey: crypto.randomUUID() },
    );
  } catch (error) {
    refusal =
      error instanceof Error ? ((error as { code?: string }).code ?? error.message) : String(error);
  }
  const unfrozen = await control(api, agentId, "agent_unfreeze", keyPair, settings.nearRpcUrl);
  return {
    freeze: { correlation_id: frozen.correlation_id, status: frozen.status },
    frozen_execution_refused_with: refusal,
    unfreeze: { correlation_id: unfrozen.correlation_id, status: unfrozen.status },
    cooldowns: (await api.getAgent(agentId)).cooldowns,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("freezing an agent");
  banner(["Freezing, proving refusal, then unfreezing…"]);
  void freezeAndUnfreeze(required(config().agentId, "AGENT_ID")).then(print);
}
