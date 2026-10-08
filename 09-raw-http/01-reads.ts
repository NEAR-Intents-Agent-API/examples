/**
 * Raw HTTP reads — no SDK.
 *
 * What: network, tokens, one agent, its policy, and quota via plain fetch.
 * When: in a runtime where you prefer not to add a dependency, or to debug the wire.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`; `AGENT_ID` for the agent read.
 * Run: `pnpm 09:reads`
 */
import { banner, config, isMainModule, print } from "../support/config.js";
import { rawRequest } from "../support/raw-http.js";

export async function reads(agentId?: string) {
  const [network, tokens] = await Promise.all([
    rawRequest<Record<string, unknown>>({ path: "/v1/network" }),
    rawRequest<{ data: unknown[] }>({ path: "/v1/tokens" }),
  ]);
  const agent = agentId
    ? await rawRequest<Record<string, unknown>>({ path: `/v1/agents/${agentId}` })
    : null;
  const policy = agentId
    ? await rawRequest<Record<string, unknown>>({ path: `/v1/agents/${agentId}/policy` })
    : null;
  return {
    network,
    token_count: tokens.data.length,
    first_tokens: tokens.data.slice(0, 3),
    agent,
    policy,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Raw HTTP reads…"]);
  void reads(config().agentId).then(print);
}
