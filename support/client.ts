import { AgentApi, type AgentApiOptions } from "@near-intents-agent-api/sdk";
import { config, required } from "./config.js";

// Re-export the whole typed contract so examples can import client helpers and types together.
export * from "@near-intents-agent-api/sdk";

/**
 * Creates the typed SDK client from `NEAR_INTENTS_AGENT_API_URL` + `NEAR_INTENTS_AGENT_API_KEY`.
 *
 * The SDK is a thin typed HTTP client: one method per endpoint, JSON:API errors, no automatic
 * retries. The key is server-side only — never ship it to a browser. A browser gets the prepared
 * wallet payload from your backend and signs it with the owner's wallet.
 */
export function agentApi(overrides: Partial<AgentApiOptions> = {}): AgentApi {
  const { apiUrl, apiKey } = config();
  return new AgentApi({
    baseUrl: overrides.baseUrl ?? apiUrl,
    apiKey: overrides.apiKey ?? required(apiKey, "NEAR_INTENTS_AGENT_API_KEY"),
    ...overrides,
  });
}

export { AgentApi };
