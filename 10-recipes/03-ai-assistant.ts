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
 *
 * Set the policy before the first session. An assistant reads untrusted text (invoices, emails,
 * web pages) and can be talked into paying a lookalike address or a fake "safe account"; the policy
 * is what holds when it is fooled. Start from `assistantPolicy`: payee only, small per-transaction
 * and daily caps, native methods off. Apply it with the `policy_update` shape in `pnpm 06:edit-policy`.
 */
import type { Policy } from "@near-intents-agent-api/sdk";
import { type AgentApi, agentApi, createGrantCredential } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { intentsAccount } from "../support/destinations.js";
import { runOwnerIntent, settleExecution } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

const nearUnits = (near: number) => `${near}${"0".repeat(24)}`;

/**
 * A starting policy for an assistant: swaps inside the account, transfers to one known payee, and
 * caps of 3 NEAR per transaction and 10 NEAR a day on the token it spends. Add payees one by one as
 * the owner trusts them; widen the caps only once the assistant has earned it.
 *
 * `native` is omitted, so every native method stays off. Keep it that way: native methods are for
 * advanced users and are not protected by this policy.
 */
export function assistantPolicy(input: {
  /** The only NEAR Intents account the assistant may send to. */
  payee: string;
  /** The asset the assistant spends. Defaults to wNEAR; any other token needs both caps. */
  token?: string;
  /** Atomic units of `token`. */
  perTransaction?: string;
  daily?: string;
}): Policy {
  const token = input.token ?? "nep141:wrap.near";
  if (token !== "nep141:wrap.near" && (!input.perTransaction || !input.daily))
    throw new Error(`Pass perTransaction and daily in ${token}'s atomic units`);
  return {
    frozen: false,
    actions: ["swap", "transfer"],
    confidential: false,
    owner_approval: false,
    assets: [token],
    limits: {
      per_transaction: { [token]: input.perTransaction ?? nearUnits(3) },
      daily: { [token]: input.daily ?? nearUnits(10) },
    },
    max_actions_per_hour: 10,
    destinations: { mode: "only", list: [intentsAccount(input.payee)] },
    budget: { daily_usd: null, weekly_usd: null, monthly_usd: null },
    timelock_ms: 0,
  };
}

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
    suggested_policy: settings.recipient
      ? assistantPolicy({ payee: settings.recipient })
      : "Set AGENT_RECIPIENT to see the starting policy for this assistant.",
    note: "The token stays on your backend. Revoke this grant when the session ends.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("issuing an assistant grant");
  banner(["Issuing a grant for an AI assistant…"]);
  void aiAssistant(required(config().agentId, "AGENT_ID")).then(print);
}
