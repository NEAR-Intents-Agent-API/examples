/**
 * Every way a native request is refused, and what each refusal means.
 *
 * What: sends requests the API must refuse and prints the error code of each: a NEAR Intents
 *       contract as recipient, an unlisted recipient, free text, an intent dressed up as a
 *       challenge, a mismatched audience, an expired challenge, a call with no grant, a native
 *       NEAR transfer to `intents.near`, and an EVM message while `evm.sign_message` is off.
 * When: before wiring native methods into your backend, so each code has a handler.
 * Needs: `AGENT_ID`, stored grant (`04:issue-grant`). `AGENT_SIGN_RECIPIENT` is used as the one
 *        valid recipient when it is listed in `native.near.sign_message`.
 * Run: `pnpm 07:refusals`
 *
 * None of these requests reaches the wallet provider and none signs anything, so this example
 * needs no `AGENT_ALLOW_WRITES`. The API checks in this order, so a request with several problems
 * gets the first code: recipient forbidden, challenge invalid, policy ready and not frozen, grant,
 * recipient list. A native NEAR transfer to `intents.near` is refused before anything is sent.
 * Branch on the code, never on the message:
 *
 * | Code | Status | Meaning |
 * |---|---|---|
 * | `signing_recipient_forbidden` | 403 | `intents.near`/`intents.far`: never, whatever the policy |
 * | `signing_policy_denied` | 403 | the recipient is not in `native.near.sign_message` (or it is empty) |
 * | `native_method_denied` | 403 | another native method whose switch is off |
 * | `native_contract_forbidden` | 403 | a native NEAR transfer or call to `intents.near`/`intents.far` |
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
  const native = policy.policy?.native;
  const listed = native?.near.sign_message ?? [];
  const valid = config().signRecipient ?? listed[0] ?? "login.example.near";
  const sign = (message: string, recipient: string) => () =>
    delegate.nativeNearSignMessage(agentId, { message, recipient });

  const cases = {
    ...Object.fromEntries(
      intentsContracts.map((contract) => [
        `recipient ${contract}`,
        sign(challengeFor(contract), contract),
      ]),
    ),
    "recipient not in native.near.sign_message": sign(
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
      api.nativeNearSignMessage(agentId, { message: challengeFor(valid), recipient: valid }),
    // Refused before the switch is read, so this sends nothing whatever `near.transfer` says.
    "NEAR transfer to intents.near": () =>
      delegate.nativeNearTransfer(
        agentId,
        { to: "intents.near", amount: "1" },
        { idempotencyKey: crypto.randomUUID() },
      ),
    "EVM message with evm.sign_message off": () =>
      native?.evm.sign_message
        ? Promise.resolve("skipped: evm.sign_message is on")
        : delegate.nativeEvmSignMessage(agentId, { chain: "ethereum", message: "hello" }),
  };

  const results: Record<string, unknown> = {};
  for (const [name, attempt] of Object.entries(cases)) results[name] = await codeOf(attempt);
  return {
    native: native ?? "none: every native method is off",
    results,
  };
}

if (isMainModule(import.meta.url)) {
  banner(["Sending native requests the API must refuse…"]);
  void signingRefusals(required(config().agentId, "AGENT_ID")).then(print);
}
