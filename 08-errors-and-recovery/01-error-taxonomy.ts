/**
 * See the real error shape and branch on codes.
 *
 * What: triggers several documented refusals and prints the structured error for each.
 * When: when writing your error handling — this is exactly what reaches your catch block.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `AGENT_ID`, stored grant (for one of the refusals).
 * Run: `pnpm 08:error-taxonomy`
 *
 * Errors are JSON:API documents. Branch on `error.code`; `layer` says whose rule refused (`request`,
 * `auth`, `grant`, `policy`, `budget`, `balance`, `provider` or `api`), so it picks the guidance.
 * `retryable` (the same Idempotency-Key can succeed), `availableAt` (from `meta.available_at`),
 * `minAmount`, `availableAmount` and `requestId` (from `meta.request_id`) guide retries and
 * support. Validation failures return one entry per field.
 */
import { AgentApiError } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";

/**
 * What to do next, from the layer that refused. The code is more specific; the layer is enough to
 * pick the right person and the right retry rule.
 */
export function guidance(error: AgentApiError): string {
  switch (error.layer) {
    case "policy":
    case "budget":
      return "The owner changes the rules or budget; repeating the request will not help.";
    case "balance":
      return error.availableAmount
        ? `Fund the account or send at most ${error.availableAmount} (atomic units).`
        : "Fund the account or send less.";
    case "request":
      return "Fix the input; do not retry it as it is.";
    case "grant":
      return "Issue a new grant or use a live one.";
    case "auth":
      return "Check the API key or the owner signature.";
    case "provider":
    case "api":
      return error.retryable
        ? "Retry the same request with the same Idempotency-Key."
        : "Repeating it will not help; change the request or wait.";
    default:
      return "Not an API error document; check the proxy or network in between.";
  }
}

async function capture(label: string, action: () => Promise<unknown>) {
  try {
    return { label, ok: true, value: await action() };
  } catch (error) {
    if (error instanceof AgentApiError)
      return {
        label,
        ok: false,
        error: {
          status: error.status,
          code: error.code,
          title: error.title,
          detail: error.detail,
          layer: error.layer,
          retryable: error.retryable,
          availableAt: error.availableAt,
          minAmount: error.minAmount,
          availableAmount: error.availableAmount,
          guidance: guidance(error),
          requestId: error.requestId,
          // Every entry, e.g. one per failed field.
          errors: error.errors,
        },
      };
    return { label, ok: false, error: String(error) };
  }
}

export async function errorTaxonomy(agentId: string) {
  const settings = config();
  const api = agentApi();
  const stored = await loadGrant(agentId);

  return {
    results: [
      // Unknown agent: a plain read error.
      await capture("unknown-agent", () => api.getAgent("0".repeat(64))),
      // Spending with no grant at all.
      await capture("no-grant", () =>
        api.transfer(
          agentId,
          {
            asset: settings.token,
            amount: settings.transferAmount,
            recipient: required(settings.recipient, "AGENT_RECIPIENT"),
          },
          { idempotencyKey: crypto.randomUUID() },
        ),
      ),
      // A policy that does not allow this action / destination.
      await capture("policy-refusal", () =>
        api.forGrant(stored.token).withdraw(
          agentId,
          {
            asset: settings.token,
            amount: settings.transferAmount,
            chain: "eth",
            recipient: "0x1111111111111111111111111111111111111111",
          },
          { idempotencyKey: crypto.randomUUID() },
        ),
      ),
      // Validation: a malformed body.
      await capture("validation", () =>
        api.transfer(agentId, { asset: "", amount: "-1", recipient: "" } as never, {
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    ],
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Capturing documented refusals as structured errors…"]);
  void errorTaxonomy(required(config().agentId, "AGENT_ID")).then(print);
}
