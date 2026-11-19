/**
 * Handle an action that needs owner approval.
 *
 * What: runs a transfer the policy gates behind approval, lists the pending approval, casts the
 *       owner's vote and follows the original execution to settlement.
 * When: when the owner's policy has `owner_approval: true` (AGENT_REQUIRE_APPROVAL=true at
 *       creation). Every owner type can enable it; this example votes as a NEAR owner.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_RECIPIENT`, stored grant.
 * Run: `pnpm 05:approvals`
 *
 * Hard policy limits always reject; approval never overrides a limit. The owner is the only
 * approver. Here a vote is a `nep413` off-chain signature by the owner; an EVM or passkey owner
 * signs an EIP-712 or WebAuthn authorization that its `0s` wallet confirms. Voting is idempotent: resubmitting the same signature is
 * safe. `SUCCESS` on the vote means the vote was recorded, not that the transfer settled —
 * follow the *execution's* original correlation id for that. An approval lists the owner votes the
 * API recorded as `votes` (`{ voter, verdict, voted_at }`, oldest first), so the example reads the
 * approval again after voting and prints them.
 *
 * Run `pnpm 05:approvals reject` to reject instead. A reject cast within a block or two of a
 * policy change can be stored while the request stays pending. The API resends it for a few
 * seconds; if the vote's `details.repeat_required` is still `true`, the owner must sign another
 * reject for the same approval. The example generates and signs a fresh `approval_vote` for that.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settleApprovedExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

const MAX_REPEATED_REJECTS = 3;

export async function approvals(agentId: string, verdict: "approve" | "reject" = "approve") {
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
  // An owner dashboard lists the requests waiting for a vote (at most 100 per agent; the next is
  // refused with `approval_backlog_full` until the owner votes); one approval reads by id.
  const queue = await api.listApprovals(agentId);
  const pending = await api.getApproval(agentId, approvalId);
  const vote = () =>
    runOwnerIntent(
      api,
      { type: "approval_vote", agent_id: agentId, approval_id: approvalId, verdict },
      (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
      { idempotencyKey: crypto.randomUUID() },
    );
  const repeatRequired = (status: Awaited<ReturnType<typeof vote>>) =>
    status.type === "approval_vote" && status.details.repeat_required === true;
  let voteStatus = await vote();
  for (let repeat = 0; repeat < MAX_REPEATED_REJECTS && repeatRequired(voteStatus); repeat++)
    voteStatus = await vote();
  if (voteStatus.status !== "SUCCESS")
    throw new Error(voteStatus.failure_code ?? `vote ${voteStatus.status}`);
  if (repeatRequired(voteStatus))
    return {
      approval_id: approvalId,
      note: "The request is still pending. The owner must sign another reject for this approval.",
    };
  const decided = await api.getApproval(agentId, approvalId);

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
    verdict,
    votes: decided.votes,
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
  void approvals(
    required(config().agentId, "AGENT_ID"),
    process.argv[2] === "reject" ? "reject" : "approve",
  ).then(print);
}
