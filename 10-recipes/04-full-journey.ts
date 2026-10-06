/**
 * The full journey, end to end.
 *
 * What: create an agent, issue a grant, read balances, quote and (if enabled) execute a swap,
 *       then audit history and containment. This is the sequence a real integration implements.
 * When: read it as a map; run it after the earlier examples.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_RECIPIENT`. Funding the agent is external:
 *        use `pnpm 05:deposit` or a transfer into its wallet before swapping.
 * Run: `pnpm 10:full-journey`
 *
 * Each step names the earlier example that explains it. Nothing here is new plumbing — it is the
 * same flows composed in order.
 */
import { agentApi, createGrantCredential } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settledAgentId, settleExecution } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { transferPolicy } from "../support/policy.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function fullJourney() {
  const settings = config();
  const api = agentApi();
  const { keyPair, owner } = loadOwner();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const sign = (generated: Parameters<typeof signNearIntent>[0]) =>
    signNearIntent(generated, keyPair, settings.nearRpcUrl);

  // 1. Create the account (02 · Your first agent).
  const created = await runOwnerIntent(
    api,
    {
      type: "agent_create",
      name: "Full journey agent",
      owner,
      policy: transferPolicy({ owner, recipient, token: settings.token }),
    },
    sign,
    { idempotencyKey: crypto.randomUUID() },
  );
  if (created.status !== "SUCCESS") throw new Error(created.failure_code ?? created.status);
  const agentId = settledAgentId(created);

  // 2. Allow swaps (06 · Policy and lifecycle): `actions` and `assets` are enforced by the provider.
  const current = await api.getPolicy(agentId);
  if (!current.policy || current.revision === null) throw new Error("policy_not_ready");
  const policyUpdate = await runOwnerIntent(
    api,
    {
      type: "policy_update",
      agent_id: agentId,
      expected_revision: current.revision,
      policy: {
        ...current.policy,
        actions: [...current.policy.actions, "swap"] as ("swap" | "transfer" | "withdraw")[],
        // A swap needs its output asset to be allowed too.
        assets:
          current.policy.assets === "any"
            ? ("any" as const)
            : [...current.policy.assets, settings.swapToToken],
      },
    },
    sign,
    { idempotencyKey: crypto.randomUUID() },
  );
  if (policyUpdate.status !== "SUCCESS")
    throw new Error(policyUpdate.failure_code ?? policyUpdate.status);

  // 3. Issue the bot grant (04 · Grants).
  const credential = createGrantCredential();
  const grantStatus = await runOwnerIntent(
    api,
    {
      type: "grant_issue",
      agent_id: agentId,
      label: "Full journey bot",
      credential: credential.commitment,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    sign,
    { idempotencyKey: crypto.randomUUID() },
  );
  if (grantStatus.status !== "SUCCESS")
    throw new Error(grantStatus.failure_code ?? grantStatus.status);
  const bot = api.forGrant(credential.token);

  // 4. Read the account (02 · inspect).
  const [agent, policy, balances] = await Promise.all([
    api.getAgent(agentId),
    api.getPolicy(agentId),
    api.getBalances(agentId),
  ]);

  // 5. Quote, then optionally swap (05 · Money moves).
  const quote = await bot.swap(agentId, {
    origin_asset: settings.token,
    destination_asset: settings.swapToToken,
    amount: settings.transferAmount,
    dry: true,
  });
  const swap = settings.execute
    ? await settleExecution(
        api,
        bot.swap(agentId, {
          origin_asset: settings.token,
          destination_asset: settings.swapToToken,
          amount: settings.transferAmount,
        }),
      )
    : null;

  // 6. Audit (04 · revoke and audit).
  const [history, containment] = await Promise.all([
    api.getHistory(agentId, { limit: 10 }),
    api.getContainment(agentId),
  ]);
  return {
    steps: {
      create: { agent_id: agentId, status: created.status },
      policy_update: { status: policyUpdate.status, revision: policy.revision },
      grant_issue: {
        status: grantStatus.status,
        grant_id:
          grantStatus.type === "grant_issue" ? grantStatus.details.grant?.grant_id : undefined,
      },
    },
    agent: { status: agent.status, wallet: agent.wallet, owner: agent.owner },
    balances: balances.balances.map((entry) => ({
      asset_id: entry.asset_id,
      balance_raw: entry.balance_raw,
    })),
    quote: quote.quote,
    swap: swap
      ? { correlation_id: swap.correlation_id, status: swap.status }
      : "skipped (AGENT_EXECUTE=false)",
    history: history.data.map((entry) => ({
      type: entry.type,
      status: entry.status,
      correlation_id: entry.correlation_id,
    })),
    containment: {
      grants: containment.grants.data.length,
      pending_operations: containment.pending_operations.data.length,
    },
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("running the full journey (creates an agent)");
  banner(["Running the full journey…"]);
  void fullJourney().then(print);
}
