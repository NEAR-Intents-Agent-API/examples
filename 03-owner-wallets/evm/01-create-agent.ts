/**
 * Create an agent owned by an EVM wallet.
 *
 * What: derives everything from one EVM private key and runs the onboarding flow with EIP-712.
 * When: when your users connect an EVM wallet instead of a NEAR account.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_OWNER_EVM_PRIVATE_KEY`, `AGENT_RECIPIENT`.
 * Run: `pnpm 03:evm-create-agent`
 *
 * The API derives a deterministic `0s` NEAR account from the public key and deploys it on first
 * use, sponsored — no NEAR account or NEAR funds are needed. `intent.standard` is `eip712`; sign
 * it with the owner's wallet (`walletClient.signTypedData`) or, as here, with `viem` directly.
 */
import { agentApi } from "../../support/client.js";
import {
  banner,
  config,
  isMainModule,
  print,
  required,
  requireWrites,
} from "../../support/config.js";
import { loadEvmOwner, signEvmIntent } from "../../support/evm-owner.js";
import { runOwnerIntent, settledAgentId } from "../../support/flow.js";
import { transferPolicy } from "../../support/policy.js";

export async function createEvmOwnedAgent() {
  const settings = config();
  const api = agentApi();
  const { account, owner } = loadEvmOwner();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");

  const status = await runOwnerIntent(
    api,
    {
      type: "agent_create",
      name: "EVM-owned agent",
      owner,
      policy: transferPolicy({ owner, recipient, token: settings.token }),
    },
    (generated) => signEvmIntent(account, generated),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `onboarding ${status.status}`);

  const agent = await api.getAgent(settledAgentId(status));
  return {
    owner: owner.address,
    agent_id: agent.id,
    status: agent.status,
    wallet: agent.wallet,
    owner_account: agent.owner_account,
    next: "Policy edits for this owner use EIP-712 too: pnpm 03:evm-policy-update",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("creating an agent (it performs an on-chain onboarding)");
  banner(["Creating an agent owned by an EVM key…"]);
  void createEvmOwnedAgent().then(print);
}
