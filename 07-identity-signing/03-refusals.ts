/**
 * Every way a signing request is refused, and what each refusal means.
 *
 * What: sends requests the API must refuse and prints the error code of each: a NEAR Intents
 *       contract as recipient, an unlisted recipient, free text, an intent dressed up as a
 *       challenge, a mismatched audience, an expired challenge, and a call with no grant.
 * When: before wiring signing into your backend, so each code has a handler.
 * Needs: `AGENT_ID`, stored grant (`04:issue-grant`). `AGENT_SIGN_RECIPIENT` is used as the one
 *        valid recipient when the policy has a `sign` rule.
 * Run: `pnpm 07:refusals`
 *
 * None of these requests reaches the custody provider and none signs anything, so this example
 * needs no `AGENT_ALLOW_WRITES`. The API checks in this order, so a request with several problems
 * gets the first code: recipient forbidden, challenge invalid, policy ready and not frozen, grant,
 * `sign` rule, recipient list.
 * Branch on the code, never on the message:
 *
 * | Code | Status | Meaning |
 * |---|---|---|
 * | `signing_recipient_forbidden` | 403 | `intents.near`/`intents.far`: never, whatever the policy |
 * | `policy_action_denied` | 403 | the policy has no `sign` rule: signing is off |
 * | `signing_policy_denied` | 403 | the recipient is not in `sign.recipients` |
 * | `signing_identity_challenge_invalid` | 400 | not the canonical, current, matching challenge |
 * | `agent_grant_required` | 403 | no live grant (`X-Grant-Token`) on the request |
 */
import { AgentApiError } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { canonicalJson, identityChallenge, intentsContracts } from "../support/identity.js";

/** A challenge built by hand, so the example can also build the invalid ones. */
function challengeFor(audience: string, changes: Record<string, string | number> = {}) {
  const issuedAtMs = Date.now();
  return canonicalJson({
    domain: "near-intents-agent-api.identity.v1",
    purpose: "identity",
    chain: "near",
    audience,
    challenge: "ab".repeat(32),
    issued_at_ms: issuedAtMs,
    expires_at_ms: issuedAtMs + 60_000,
    ...changes,
  });
}

async function codeOf(attempt: () => Promise<unknown>) {
  try {
    await attempt();
    return { refused: false, code: null };
  } catch (error) {
    if (error instanceof AgentApiError)
      return { refused: true, status: error.status, code: error.code };
    throw error;
  }
}

export async function signingRefusals(agentId: string) {
  const api = agentApi();
  const stored = await loadGrant(agentId);
  const delegate = api.forGrant(stored.token);
  const policy = await api.getPolicy(agentId);
  const listed = policy.policy?.sign?.recipients ?? [];
  const valid = config().signRecipient ?? listed[0] ?? "login.example.near";
  const sign = (message: string, recipient: string) => () =>
    delegate.sign(agentId, { message, recipient });

  const cases = {
    ...Object.fromEntries(
      intentsContracts.map((contract) => [
        `recipient ${contract}`,
        sign(challengeFor(contract), contract),
      ]),
    ),
    "recipient not in sign.recipients": sign(
      challengeFor("not-listed.example.near"),
      "not-listed.example.near",
    ),
    "free text instead of a challenge": sign("approve transfer of 10 USDC", valid),
    // Intent fields can never ride along: the envelope accepts exactly its seven fields.
    "intent fields added to the challenge": sign(
      challengeFor(valid, {
        signer_id: "victim.near",
        deadline: new Date(Date.now() + 60_000).toISOString(),
        intents: "[]",
      }),
      valid,
    ),
    "audience differs from recipient": sign(challengeFor("other.example.near"), valid),
    "expired challenge": sign(
      challengeFor(valid, { issued_at_ms: Date.now() - 120_000, expires_at_ms: Date.now() - 1 }),
      valid,
    ),
    // The right fields in declaration order instead of sorted: the API signs one spelling only.
    "keys not sorted (not canonical)": sign(
      JSON.stringify(identityChallenge(valid).challenge),
      valid,
    ),
    "API key only, no grant": () =>
      api.sign(agentId, { message: challengeFor(valid), recipient: valid }),
  };

  const results: Record<string, unknown> = {};
  for (const [name, attempt] of Object.entries(cases)) results[name] = await codeOf(attempt);
  return {
    sign_rule: policy.policy?.sign ?? "none: every grant is refused with policy_action_denied",
    results,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Sending signing requests the API must refuse…"]);
  void signingRefusals(required(config().agentId, "AGENT_ID")).then(print);
}
