/**
 * Create an agent and its first grant with one owner signature.
 *
 * What: runs the owner onboarding flow with a grant in the same `agent_create`, checks the
 *       generated intent before the wallet signs, and stores the grant token on success.
 * When: instead of `02:create-agent` followed by `04:issue-grant`, when the agent's first client
 *       is known at creation. Creates a new agent every run.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_OWNER_ACCOUNT_ID`, `AGENT_OWNER_PRIVATE_KEY`,
 *        `AGENT_RECIPIENT` (the only address the starter policy allows).
 * Run: `pnpm 02:create-with-grant`
 *
 * The grant is hashed into the policy commitment the wallet signs, so one signature creates the
 * agent and authorizes the grant. A NEAR or EVM wallet shows the owner only that hash, so your
 * backend calls `verifyAgentCreateIntent` first: it throws unless the hash commits to exactly the
 * previewed policy and the grant you asked for. The token never reaches the API, only its
 * commitment, as with `grant_issue`.
 *
 * The agent exists whatever happens to the grant. `details.grant_install` says which: use the
 * token only on `installed`; `refused:grant_credential_reused` (another onboarding bound the
 * token first) and `refused:grant_expired` leave an agent with no grant, to issue with
 * `04:issue-grant`. `expires_at` must outlast the signing window, and a token already bound is
 * refused at `generateIntent`, before any agent exists.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGrantCredential, verifyAgentCreateIntent } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { runOwnerIntent, settledAgentId } from "../support/flow.js";
import { saveGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { transferPolicy } from "../support/policy.js";
import { signNearIntent } from "../support/sign-near-intent.js";

export async function createWithGrant() {
  const settings = config();
  const api = agentApi();
  const { keyPair, owner } = loadOwner();
  const recipient = required(settings.recipient, "AGENT_RECIPIENT");
  const policy = transferPolicy({
    recipient,
    token: settings.token,
    requireApproval: settings.requireApproval,
  });

  // The backend owns the token; only its commitment is signed. Keep the labels ASCII: wallets
  // break on non-ASCII characters in signed strings.
  const credential = createGrantCredential();
  const grantTerms = {
    label: "Example first grant",
    credential: credential.commitment,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const status = await runOwnerIntent(
    api,
    { type: "agent_create", name: "My first agent with a grant", owner, policy, grant: grantTerms },
    async (generated) => {
      // Before the wallet signs: throws AgentCreateVerificationError unless the signed hash
      // commits to exactly generated.preview.policy and the grant asked for above.
      verifyAgentCreateIntent(generated, { grant: grantTerms });
      return signNearIntent(generated, keyPair, settings.nearRpcUrl);
    },
    {
      idempotencyKey: crypto.randomUUID(),
      // Persist the generated intent before signing: an interrupted onboarding resumes from here
      // instead of creating a second agent.
      save: async (generated) => {
        const directory = join(process.cwd(), ".intents");
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${generated.agent_id}.intent.json`),
          JSON.stringify(generated, null, 2),
          { mode: 0o600, flag: "w" },
        );
      },
    },
  );
  if (status.status !== "SUCCESS" || status.type !== "agent_create")
    throw new Error(status.failure_code ?? `onboarding ${status.status}`);

  const agentId = settledAgentId(status);
  const { grant, grant_install: install } = status.details;
  if (install !== "installed" || !grant)
    return {
      agent_id: agentId,
      grant_install: install,
      next: "The agent exists without a grant. Run pnpm 04:issue-grant with AGENT_ID set to it.",
    };

  await saveGrant({
    agent_id: agentId,
    grant_id: grant.grant_id,
    token: credential.token,
    label: grant.label,
    expires_at: grantTerms.expires_at,
  });
  return {
    agent_id: agentId,
    grant_install: install,
    grant_id: grant.grant_id,
    label: grant.label,
    expires_at: grantTerms.expires_at,
    // Keep this on the backend: it is the only copy. Shown here because this is an example.
    token: credential.token,
    next: "Put the agent_id in .env as AGENT_ID, then run pnpm 04:delegate-client to act under the grant.",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("creating an agent (it performs an on-chain onboarding)");
  banner(["Creating an agent and its first grant with one owner signature…"]);
  void createWithGrant().then(print);
}
