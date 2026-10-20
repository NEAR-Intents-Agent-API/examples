/**
 * Every way a native request is refused, and what each refusal means.
 *
 * What: sends requests the API must refuse and prints the error code of each: a NEAR Intents
 *       contract as recipient, an unlisted recipient, a malformed nonce, a call with no grant, a
 *       native NEAR transfer to `intents.near`, and an EVM message while `evm.sign_message` is off.
 * When: before wiring native methods into your backend, so each code has a handler.
 * Needs: `AGENT_ID`, stored grant (`04:issue-grant`). `AGENT_SIGN_RECIPIENT` is used as the one
 *        valid recipient when it is listed in `native.near.sign_message`.
 * Run: `pnpm 07:refusals`
 *
 * None of these requests reaches the wallet provider and none signs anything, so this example
 * needs no `AGENT_ALLOW_WRITES`. The API checks in this order, so a request with several problems
 * gets the first code: request shape, recipient forbidden, policy ready and not frozen, grant,
 * recipient list. A native NEAR transfer to `intents.near` is refused before anything is sent.
 * Branch on the code, never on the message:
 *
 * | Code | Status | Meaning |
 * |---|---|---|
 * | `signing_recipient_forbidden` | 403 | `intents.near`/`intents.far`: never, whatever the policy |
 * | `signing_policy_denied` | 403 | the recipient is not in `native.near.sign_message` (or it is empty) |
 * | `native_method_denied` | 403 | another native method whose switch is off |
 * | `native_contract_forbidden` | 403 | a native NEAR transfer or call to `intents.near`/`intents.far` |
 * | `validation_failed` | 400 | the body is malformed, e.g. the nonce is not 32 bytes of base64 |
 * | `agent_grant_required` | 403 | no live grant (`X-Grant-Token`) on the request |
 */
import { AgentApiError } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { intentsContracts, loginRequest } from "../support/identity.js";

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
  const login = loginRequest(valid);
  const sign = (recipient: string, changes: { nonce?: string } = {}) => () =>
    delegate.nativeNearSignMessage(agentId, { ...login, recipient, ...changes });

  const cases = {
    ...Object.fromEntries(
      intentsContracts.map((contract) => [`recipient ${contract}`, sign(contract)]),
    ),
    // Case does not matter for the Intents contracts.
    "recipient INTENTS.near": sign("INTENTS.near"),
    "recipient not in native.near.sign_message": sign("not-listed.example.near"),
    "nonce that is not 32 bytes": sign(valid, { nonce: "AAAA" }),
    "API key only, no grant": () => api.nativeNearSignMessage(agentId, { ...login }),
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
