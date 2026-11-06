/**
 * Prove what the API recorded for one execution, without trusting the API.
 *
 * What: reads the checkpoint witness's head, fetches an execution's operation proof that extends
 *       it, and checks it with `verifyOperationProof`: the proof's checkpoint extends the witness
 *       head (the log was not rolled back or forked), each `PROVEN` audit event hashes to a leaf of
 *       the API's transparency log, that leaf is in a checkpoint signed by the log key and
 *       cosigned by the notary, and the event names this execution. Each proven event's `evidence`, the result it recorded with its settlement
 *       transaction hashes, matches the `evidenceHash` its opening committed. Prints what was
 *       proven and what is still pending.
 * When: an owner, auditor or partner wants evidence that an execution's history (admitted,
 *       dispatched, completed, …) was logged by the attested code and never rewritten.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`; an execution correlation id (`op_…`) as argv[2],
 *        or the agent's most recent execution. `AGENT_LOG_ORIGIN` and `AGENT_WITNESS_KEY` when your
 *        API is not the hosted one.
 * Run: `pnpm 11:verify-operation [op_…]`
 *
 * Read-only. Pin the log origin and the witness key yourself (`AGENT_LOG_ORIGIN`,
 * `AGENT_WITNESS_KEY`); never take either from an API response. A proof for another log, or one
 * that does not extend the witness head, is refused. Proofs use the latest checkpoint, so a fresh
 * event reads `PENDING` for a short while; run again later. Events older than the log read
 * `UNLOGGED`. A deployment without a transparency log answers `501 transparency_log_disabled`. If
 * the API's log has not yet reached the witness head it answers
 * `409 transparency_checkpoint_behind`; run again in a moment.
 *
 * This checks the signatures, not where the keys came from. To tie them to attested code, verify
 * the notary's TDX birth quote (`proof.notary.birth`) with a quote verifier such as
 * dstack-verifier and compare its `report_data` with `verified.birthReportData`.
 */
import {
  AgentApiError,
  fetchWitnessCheckpoint,
  NoteError,
  ProofError,
  verifyOperationProof,
} from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";

/** Owner intents (`intent_…`) have no operation proof; only executions do. */
async function latestExecution(agentId: string) {
  const history = await agentApi().getHistory(agentId, { limit: 25 });
  const execution = history.data.find((entry) => entry.correlation_id.startsWith("op_"));
  if (!execution)
    throw new Error("No execution in this agent's recent history; run a 05 money move first.");
  return execution.correlation_id;
}

export async function verifyOperation(agentId: string, correlationId: string) {
  const { apiUrl, logOrigin, witnessKey } = config();
  const api = agentApi();

  try {
    // The trusted head: signed by the witness key you pinned, so the API cannot forge it. Fetch it
    // right before the proof, and ask for a proof that extends it.
    const head = await fetchWitnessCheckpoint(apiUrl, logOrigin, witnessKey);

    let proof: Awaited<ReturnType<typeof api.getOperationProof>>;
    try {
      proof = await api.getOperationProof(agentId, correlationId, {
        from_size: String(head.size),
      });
    } catch (error) {
      if (error instanceof AgentApiError && error.code === "transparency_log_disabled")
        return { verified: false, reason: "This API deployment keeps no transparency log." };
      if (error instanceof AgentApiError && error.code === "transparency_checkpoint_behind")
        return {
          verified: false,
          reason: `The API's log has not reached the witness head (size ${head.size}) yet. Nothing is wrong with the proof; run this again in a moment.`,
        };
      throw error;
    }

    const verified = verifyOperationProof(proof, logOrigin, head);
    return {
      verified: true,
      correlation_id: proof.correlation_id,
      origin: proof.origin,
      witness_head_size: head.size.toString(),
      proven: verified.proven.map((event) => ({
        action: event.fields.action,
        created_at: event.fields.createdAt,
        leaf_index: event.index.toString(),
        checkpoint_size: event.checkpoint.size.toString(),
        cosigned_at: new Date(Number(event.cosignedAt) * 1000).toISOString(),
        // Checked against the opening's `evidenceHash`; null when the API served none.
        evidence: event.evidence,
      })),
      pending: verified.pending,
      unlogged: verified.unlogged,
      // The next step: a genuine TDX quote from the notary's birth must carry exactly this.
      birth_report_data: verified.birthReportData,
      next:
        verified.pending > 0
          ? "Some events wait for the next checkpoint; run this again in a minute."
          : "Verify the notary's birth quote and compare its report_data with birth_report_data.",
    };
  } catch (error) {
    // The witness head or the proof does not hold: wrong log, bad signature, a log that does not
    // extend the witness head, an opening that is not this event, or evidence altered after it was
    // committed.
    if (error instanceof NoteError || error instanceof ProofError)
      return { verified: false, reason: `${error.name}: ${error.message}` };
    throw error;
  }
}

if (isMainModule(import.meta.url)) {
  const agentId = required(config().agentId, "AGENT_ID");
  const correlationId = process.argv[2] ?? (await latestExecution(agentId));
  banner([`Verifying the audit trail of ${correlationId} against ${config().logOrigin}…`]);
  void verifyOperation(agentId, correlationId).then(print);
}
