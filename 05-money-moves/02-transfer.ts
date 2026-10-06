/**
 * Transfer to another NEAR Intents account.
 *
 * What: sends `AGENT_TRANSFER_AMOUNT` of `AGENT_TOKEN` to `AGENT_RECIPIENT`.
 * When: moving value between accounts the agent controls or pays out to.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, `AGENT_RECIPIENT`, a stored grant, and a policy
 *        whose `actions` include `transfer` and whose `destinations` allow that recipient.
 * Run: `pnpm 05:transfer`
 *
 * Idempotency keys name one logical request. Pass a stable key (`order-123`) when your system
 * already identifies the transfer; a generated key is fine for a one-off. On a transport error,
 * retry with the *same* key — never a new one.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { settleExecution } from "../support/flow.js";
import { loadGrant } from "../support/grant-store.js";

export async function transfer(agentId: string) {
  const settings = config();
  const api = agentApi();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const stored = await loadGrant(agentId);
  const bot = api.forGrant(stored.token);

  const status = await settleExecution(
    api,
    bot.transfer(
      agentId,
      { asset: settings.token, amount: settings.transferAmount, recipient },
      { idempotencyKey: `example-transfer-${agentId}-${recipient}` },
    ),
  );
  return {
    correlation_id: status.correlation_id,
    status: status.status,
    failure_code: status.failure_code,
    // A refusal names the blocking layer: grant, policy or budget.
    details: status.details,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("executing a transfer");
  banner(["Transferring under a stored grant…"]);
  void transfer(required(config().agentId, "AGENT_ID")).then(print);
}
