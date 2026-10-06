/**
 * Give an AI assistant its own grant and map its tools to agent actions.
 *
 * What: issues a grant for an assistant session, then shows each tool mapping to an API call.
 * When: connecting Claude, Codex, a custom agent loop — anything that acts on the owner's behalf.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`.
 * Run: `pnpm 10:ai-assistant`
 *
 * One grant per session. The assistant never sees the API key; your backend runs the calls and
 * keeps the token. The assistant can do exactly what the account policy allows and no more,
 * within the shared USD budget; narrow the policy to narrow every grant.
 */
import { type AgentApi, agentApi, createGrantCredential } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settleExecution } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** The assistant's tool definitions. Each maps to exactly one agent action. */
export function assistantTools(api: AgentApi, agentId: string, token: string) {
  return {
    async get_portfolio() {
      const [publicBalances, confidential] = await Promise.all([
        api.getBalances(agentId, { source: "public" }),
        api.getBalances(agentId, { source: "confidential" }),
      ]);
      return { public: publicBalances.balances, confidential: confidential.balances };
    },
    async quote_swap(input: { from: string; to: string; amount: string }) {
      return api.forGrant(token).swap(agentId, {
        origin_asset: input.from,
        destination_asset: input.to,
        amount: input.amount,
        dry: true,
      });
    },
    async execute_swap(input: { from: string; to: string; amount: string }) {
      return settleExecution(
        api,
        api.forGrant(token).swap(agentId, {
          origin_asset: input.from,
          destination_asset: input.to,
          amount: input.amount,
        }),
      );
    },
    async send(input: { asset: string; amount: string; to: string }) {
      return settleExecution(
        api,
        api
          .forGrant(token)
          .transfer(
            agentId,
            { asset: input.asset, amount: input.amount, recipient: input.to },
            { idempotencyKey: `assistant-${crypto.randomUUID()}` },
          ),
      );
    },
  };
}

export async function aiAssistant(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();
  const credential = createGrantCredential();

  const status = await runOwnerIntent(
    api,
    {
      type: "grant_issue",
      agent_id: agentId,
      label: "Example assistant session",
      credential: credential.commitment,
      // Sessions are usually short-lived; the owner re-authorizes next time.
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS") throw new Error(status.failure_code ?? status.status);

  const tools = assistantTools(api, agentId, credential.token);
  // The assistant calls tools; the backend executes them under the grant.
  const portfolio = await tools.get_portfolio();
  const quote = await tools.quote_swap({
    from: settings.token,
    to: settings.swapToToken,
    amount: settings.transferAmount,
  });
  return {
    grant: status.type === "grant_issue" ? status.details.grant : null,
    tool_names: Object.keys(tools),
    portfolio,
    quote: quote.quote,
    note: "The token stays on your backend. Revoke this grant when the session ends.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("issuing an assistant grant");
  banner(["Issuing a grant for an AI assistant…"]);
  void aiAssistant(required(config().agentId, "AGENT_ID")).then(print);
}
