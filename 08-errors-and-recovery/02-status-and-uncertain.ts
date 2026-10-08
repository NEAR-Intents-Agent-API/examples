/**
 * Observe a status and know when recovery is legal.
 *
 * What: reads a correlation id and classifies the result: keep polling, stop, or reconcile.
 * When: every integration needs this classification before it retries anything.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`; a `CORRELATION_ID` argument or a fresh execution from the grant.
 * Run: `pnpm 08:status-and-uncertain` (optionally pass a correlation id as argv[2])
 *
 * The rule that protects funds: an UNCERTAIN operation may already have executed. Submitting a
 * new request with a new key can double-spend. Observe the original id; only `/recover` — with
 * the original key and proof the provider was never reached — may dispatch it.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";

type Classification = "poll" | "settled" | "waiting-external" | "reconcile" | "review";

function classify(status: string): Classification {
  switch (status) {
    case "PROCESSING":
    case "QUEUED":
      return "poll";
    case "SUCCESS":
    case "FAILED":
    case "REFUNDED":
      return "settled";
    case "PENDING_SIGNATURE":
    case "PENDING_APPROVAL":
    case "PENDING_DEPOSIT":
      return "waiting-external";
    case "UNCERTAIN":
      return "reconcile";
    case "NEEDS_REVIEW":
      return "review";
    default:
      return "review";
  }
}

export async function observe(correlationId: string) {
  const api = agentApi();
  const status = await api.getStatus(correlationId, { waitMs: 30_000 });
  const classification = classify(status.status);
  return {
    correlation_id: status.correlation_id,
    type: status.type,
    status: status.status,
    failure_code: status.failure_code,
    dispatch_committed_at: status.dispatch_committed_at,
    grant: status.grant,
    classification,
    guidance: {
      poll: "Not settled yet. Poll the same correlation_id (waitMs ≤ 30 000).",
      settled: "Terminal with evidence. No retry needed; read details for hashes.",
      "waiting-external": "Waiting on a human or external funds. Do not resubmit.",
      reconcile:
        "Outcome unknown. Observe the original correlation_id; never resubmit with a new key. Recover only with proof the provider was never reached.",
      review:
        "Automatic settlement stopped. Inspect details.reason, keep the budget charged, and after resolution call getStatus(…, { refresh: true }).",
    }[classification],
  };
}

if (isMainModule(import.meta.url)) {
  const correlationId = process.argv[2];
  if (correlationId) {
    banner([`Observing ${correlationId}…`]);
    void observe(correlationId).then(print);
  } else {
    const { loadGrant } = await import("../support/grant-store.js");
    const stored = await loadGrant(required(config().agentId, "AGENT_ID"));
    // With no argument, observe the stored grant's agent history instead of guessing.
    banner(["No correlation id passed; reading recent history instead…"]);
    const api = agentApi();
    void api.getHistory(stored.agent_id, { limit: 5 }).then((history) =>
      print(
        history.data.map((entry) => ({
          correlation_id: entry.correlation_id,
          type: entry.type,
          status: entry.status,
          classification: classify(entry.status),
        })),
      ),
    );
  }
}
