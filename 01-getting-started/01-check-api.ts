/**
 * Check your connection to the API.
 *
 * What: confirms the URL is reachable, the network is mainnet, your API key is valid, and the
 *       token catalog loads.
 * When: the first thing to run after pasting `AGENT_API_URL` and `AGENT_API_KEY`.
 * Needs: `AGENT_API_URL`, `AGENT_API_KEY`.
 * Run: `pnpm 01:check-api`
 *
 * `/health`, `/v1/network` and `/v1/tokens` are public. `/v1/whoami` is the API-key check: it
 * returns only the key id and tenant id, never the key itself.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print } from "../support/config.js";

export async function checkApi() {
  const { apiUrl } = config();
  const api = agentApi();

  const health = await fetch(`${apiUrl}/health`).then((response) => response.json());
  const [network, whoami, quota, tokens] = await Promise.all([
    api.getNetwork(),
    api.whoami(),
    api.getPartnerQuota(),
    // The SDK form of `GET /v1/tokens`; `01:list-tokens` reads it with plain fetch and no key.
    api.getTokens(),
  ]);

  return {
    health,
    network,
    // The key identifies your tenant. It never authorizes moving an owner's funds by itself.
    whoami,
    quota: {
      limits: quota.limits,
      usage: quota.usage,
      observed_at: quota.observed_at,
    },
    token_count: tokens.length,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Checking API connectivity…"]);
  void checkApi().then(print);
}
