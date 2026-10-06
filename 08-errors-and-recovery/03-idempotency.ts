/**
 * Idempotency: same key, same work; new key, new work.
 *
 * What: runs a request twice with the same key (replay), then shows how a lost reply is recovered.
 * When: before writing any retry logic. This is the whole contract in one file.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, `AGENT_RECIPIENT`, stored grant.
 * Run: `pnpm 08:idempotency`
 *
 * Rules:
 * - Generate the key, persist it with the request, *then* send.
 * - Retry a transport error with the stored key; the server returns the stored outcome.
 * - Same key with a different body is refused with `idempotency_conflict`.
 * - Each call with an omitted key is new work; the SDK returns the generated key with the result.
 */
import { AgentApiError, createIdempotencyKey } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";

export async function idempotency(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  // Persist this before dispatch: a crash between here and the response is recoverable.
  const idempotencyKey = createIdempotencyKey();
  const request = { asset: settings.token, amount: settings.transferAmount, recipient };

  const first = await bot.transfer(agentId, request, { idempotencyKey });
  // The same key with the same body returns the stored operation — no second transfer.
  const replay = await bot.transfer(agentId, request, { idempotencyKey });

  let conflict: string | null = null;
  try {
    // Same key, different body: refused, never executed.
    await bot.transfer(
      agentId,
      { ...request, amount: (BigInt(settings.transferAmount) + 1n).toString() },
      { idempotencyKey },
    );
  } catch (error) {
    if (error instanceof AgentApiError) conflict = error.code;
  }

  return {
    idempotencyKey,
    first: { correlation_id: first.correlation_id, status: first.status },
    replay: {
      correlation_id: replay.correlation_id,
      status: replay.status,
      same_correlation_id: first.correlation_id === replay.correlation_id,
    },
    different_body_with_same_key: conflict,
    note: "Persist the key before sending; retries must reuse it, never mint a new one.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("running an idempotent transfer");
  banner(["Demonstrating idempotent replay…"]);
  void idempotency(required(config().agentId, "AGENT_ID")).then(print);
}
