/**
 * Create your first agent.
 *
 * What: runs the full owner onboarding flow and prints the new agent id.
 * When: after `01-check-api` succeeds, once. Keep the printed id in `.env` as `AGENT_ID`.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_OWNER_ACCOUNT_ID`, `AGENT_OWNER_PRIVATE_KEY`,
 *        `AGENT_RECIPIENT` (the only address the starter policy allows).
 * Run: `pnpm 02:create-agent`
 *
 * One signature creates the account: the same policy binds the provider's rules, the USD budget
 * and the execution delay. The agent gets its own custody wallet; the owner keeps the NEAR
 * account and keys.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settledAgentId } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { transferPolicy } from "../support/policy.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function createAgent() {
  const settings = config();
  const api = agentApi();
  const { keyPair, owner } = loadOwner();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const policy = transferPolicy({
    owner,
    recipient,
    token: settings.token,
    requireApproval: settings.requireApproval,
  });

  const status = await runOwnerIntent(
    api,
    { type: "agent_create", name: "My first agent", owner, policy },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    {
      idempotencyKey: crypto.randomUUID(),
      // Persist the generated intent before signing: an interrupted onboarding resumes from here
      // instead of creating a second agent.
      save: async (generated) => {
        const directory = join(process.cwd(), ".intents");
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${generated.agent_id}.intent.json`),
          JSON.stringify(generated, null, 2),
          { mode: 0o600, flag: "w" },
        );
      },
    },
  );
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `onboarding ${status.status}`);

  const agent = await api.getAgent(settledAgentId(status));
  return {
    agent_id: agent.id,
    status: agent.status,
    owner: agent.owner,
    owner_account: agent.owner_account,
    wallet: agent.wallet,
    next: "Put the agent_id in .env as AGENT_ID, then run pnpm 02:inspect-agent",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("creating an agent (it performs an on-chain onboarding)");
  banner(["Creating an agent with one owner signature…"]);
  void createAgent().then(print);
}
