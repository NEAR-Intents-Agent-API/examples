/**
 * Create several agents for one owner.
 *
 * What: loops the onboarding flow and prints every agent id, with its own custody wallet and
 *       policy. Shows that an owner can hold many independent accounts.
 * When: when one backend serves many of an owner's agents (or many external users).
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_RECIPIENT`, `AGENT_COUNT` (default 2).
 * Run: `pnpm 02:multiple-agents`
 *
 * `external_user_id` binds each agent to your application's user. Use it to list an application
 * user's agents: `listAgents({ external_user_id })`.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settledAgentId } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { transferPolicy } from "../support/policy.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function createMultipleAgents() {
  const settings = config();
  const api = agentApi();
  const { keyPair, owner } = loadOwner();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const policy = transferPolicy({ owner, recipient, token: settings.token });
  const agents = [];
  for (let index = 1; index <= settings.agentCount; index += 1) {
    const status = await runOwnerIntent(
      api,
      {
        type: "agent_create",
        name: `Agent ${index}`,
        external_user_id: `example-user-${index}`,
        owner,
        policy,
      },
      (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
      { idempotencyKey: crypto.randomUUID() },
    );
    if (status.status !== "SUCCESS")
      throw new Error(`agent ${index}: ${status.failure_code ?? status.status}`);
    const agent = await api.getAgent(settledAgentId(status));
    agents.push({
      id: agent.id,
      name: agent.name,
      external_user_id: agent.external_user_id,
      wallet: agent.wallet?.near_account_id,
    });
  }
  // Each agent id can be filtered by external_user_id later.
  const bound = await api.listAgents({ external_user_id: "example-user-1" });
  return { created: agents, listed_for_user_1: bound.data.map((agent) => agent.id) };
}

if (isMainModule(import.meta.url)) {
  requireWrites("creating agents (each performs an on-chain onboarding)");
  banner(["Creating several agents for one owner…"]);
  void createMultipleAgents().then(print);
}
