/**
 * Handle an action that needs owner approval.
 *
 * What: runs a transfer the policy gates behind approval, lists the pending approval, casts the
 *       owner's vote and follows the original execution to settlement.
 * When: when the owner's policy has `owner_approval: true` (AGENT_REQUIRE_APPROVAL=true at
 *       creation). Only NEAR owners can enable it.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_RECIPIENT`, stored grant.
 * Run: `pnpm 05:approvals`
 *
 * Hard policy limits always reject; approval never overrides a limit. The owner is the only
 * approver, and a vote is a `nep413` off-chain signature by the owner. Voting is idempotent: resubmitting the same signature is
 * safe. `SUCCESS` on the vote means the vote was recorded, not that the transfer settled —
 * follow the *execution's* original correlation id for that.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settleApprovedExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function approvals(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const { keyPair } = loadOwner();
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const execution = await bot.transfer(
    agentId,
    { asset: settings.token, amount: settings.transferAmount, recipient },
    { idempotencyKey: `example-approval-${crypto.randomUUID()}` },
  );
  if (execution.status !== "PENDING_APPROVAL")
    return {
      execution,
      note: "No approval was required. Set AGENT_REQUIRE_APPROVAL=true and recreate the agent to see the flow.",
    };

  const approvalId = execution.details.approval_id;
  if (!approvalId) throw new Error("pending approval without approval_id");
  // An owner dashboard lists every request waiting for a vote; one approval reads by id.
  const queue = await api.listApprovals(agentId);
  const pending = await api.getApproval(agentId, approvalId);
  const voteStatus = await runOwnerIntent(
    api,
    { type: "approval_vote", agent_id: agentId, approval_id: approvalId, verdict: "approve" },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (voteStatus.status !== "SUCCESS")
    throw new Error(voteStatus.failure_code ?? `vote ${voteStatus.status}`);

  // The vote unblocks the execution; observe the execution's own correlation id until it leaves
  // PENDING_APPROVAL and settles.
  const settled = await settleApprovedExecution(api, execution.correlation_id);
  return {
    waiting: queue.map((approval) => ({
      approval_id: approval.approval_id,
      request_type: approval.request_type,
      expires_at: approval.expires_at,
    })),
    request_type: pending.request_type,
    verdict: "approve",
    execution: {
      correlation_id: settled.correlation_id,
      status: settled.status,
      failure_code: settled.failure_code,
    },
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("running an approval-gated transfer");
  banner(["Running an approval-gated transfer…"]);
  void approvals(required(config().agentId, "AGENT_ID")).then(print);
}
