/**
 * Issue a grant bound to a GitHub Actions workflow.
 *
 * What: has the owner sign an `oidc` grant that trusts GitHub's issuer for one repository and one
 *       environment. Nothing secret is created, so there is nothing to store.
 * When: a CI job should act on the agent account without holding a long-lived token.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_GITHUB_REPOSITORY`
 *        (`owner/repo`; optionally `AGENT_GITHUB_ENVIRONMENT`, default `production`).
 * Run: `pnpm 04:issue-oidc-grant`
 *
 * This is the owner's side and runs on your machine. The job's side runs only inside GitHub
 * Actions (`04:delegate-from-ci`, with `github-actions.example.yml`).
 *
 * A shared issuer signs tokens for every repository on GitHub, so the binding pins immutable ids,
 * never names (a repository can be renamed and its old name registered by someone else): the
 * numeric owner and repository ids, and the environment. Prefer an environment with protection
 * rules: it is the one claim reviewers gate. Leave `audience` out: for GitHub the API fixes it to
 * `{API url}/v1/agents/{agent_id}`, and the job asks GitHub for a token with exactly that audience
 * (`oidcGrantAudience`).
 */

import { oidcGrantAudience } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";

/** The immutable ids a binding pins. `GET /repos/{owner}/{repo}` is public for public repositories. */
async function repositoryIds(repository: string) {
  const response = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: { accept: "application/vnd.github+json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`GitHub repository ${repository}: HTTP ${response.status} (is it public?)`);
  const { id, owner } = (await response.json()) as { id: number; owner: { id: number } };
  return { repository_owner_id: String(owner.id), repository_id: String(id) };
}

export async function issueOidcGrant(agentId: string) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();
  const repository = required(settings.githubRepository, "AGENT_GITHUB_REPOSITORY");

  const claims = {
    ...(await repositoryIds(repository)),
    environment: settings.githubEnvironment,
  };

  const status = await runOwnerIntent(
    api,
    {
      type: "grant_issue",
      agent_id: agentId,
      label: "Example CI job (OIDC)",
      credential: { type: "oidc", issuer: GITHUB_ISSUER, claims },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    (generated) => signNearIntent(generated, keyPair, settings.nearRpcUrl),
    { idempotencyKey: crypto.randomUUID() },
  );
  if (status.status !== "SUCCESS" || status.type !== "grant_issue" || !status.details.grant)
    throw new Error(status.failure_code ?? `grant ${status.status}`);

  const grant = status.details.grant;
  return {
    grant_id: grant.grant_id,
    label: grant.label,
    expires_at: grant.expires_at,
    credential_type: grant.credential_type,
    trusts: { issuer: GITHUB_ISSUER, claims },
    // The job asks GitHub for a token with this audience; the API checks it on every exchange.
    audience: oidcGrantAudience(settings.apiUrl, agentId),
    next: "Copy github-actions.example.yml into the repository to run 04:delegate-from-ci.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("issuing an OIDC grant");
  banner(["Issuing a grant bound to a GitHub Actions workflow…"]);
  void issueOidcGrant(required(config().agentId, "AGENT_ID")).then(print);
}
