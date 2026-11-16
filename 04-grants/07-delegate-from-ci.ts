/**
 * Act through an OIDC grant from inside GitHub Actions.
 *
 * What: asks GitHub for an identity token, lets the SDK exchange it for a 15-minute session and
 *       previews a withdrawal under it.
 * When: a CI job that should act on the agent account with no stored grant token.
 * Needs: `NEAR_INTENTS_AGENT_API_KEY`, `NEAR_INTENTS_AGENT_API_URL`, `AGENT_ID`, `AGENT_RECIPIENT`,
 *        and a job with `permissions: id-token: write` (GitHub sets the two variables this reads).
 * Run: only in a workflow (`04-grants/github-actions.example.yml`), as `pnpm 04:delegate-from-ci`.
 *
 * This runs only inside the platform that issues the token: locally GitHub has nothing to hand
 * over, and the script says so instead of failing in the SDK. A grant from `04:issue-oidc-grant`
 * must exist, naming this repository and environment; the job's `environment:` must match it.
 *
 * `subjectToken` is called for every exchange, so it asks GitHub again instead of caching: the
 * SDK exchanges on the first delegated call, keeps the session and exchanges again in the
 * background shortly before it ends. The API key still authenticates the partner on every call; the identity token
 * replaces only the grant token.
 */

import { oidcGrantAudience } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";

/** GitHub's token for one audience, from the job's request URL and bearer (set by `id-token: write`). */
async function githubIdToken(audience: string): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !bearer)
    throw new Error(
      "Not inside GitHub Actions with `permissions: id-token: write`: there is no identity token to request. This example runs only in a workflow (04-grants/github-actions.example.yml).",
    );
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { authorization: `bearer ${bearer}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub identity token: HTTP ${response.status}`);
  const { value } = (await response.json()) as { value?: string };
  if (!value) throw new Error("GitHub returned no identity token");
  return value;
}

export async function useOidcGrant(agentId: string) {
  const settings = config();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  // Must be the URL the API publishes: the audience is built from it.
  const audience = oidcGrantAudience(settings.apiUrl, agentId);
  const bot = agentApi().forGrantSession(agentId, { subjectToken: () => githubIdToken(audience) });

  const preview = await bot.withdraw(agentId, {
    asset: settings.token,
    amount: settings.transferAmount,
    chain: "near",
    recipient,
    dry: true,
  });
  return {
    audience,
    quote: preview.quote,
    warnings: preview.warnings,
    note: "Preview only: nothing moved. The job held no grant token.",
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Previewing a withdrawal under an OIDC grant (GitHub Actions only)…"]);
  void useOidcGrant(required(config().agentId, "AGENT_ID")).then(print);
}
