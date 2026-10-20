/**
 * Turn native methods off, for one signing recipient or entirely.
 *
 * What: removes `AGENT_SIGN_RECIPIENT` from `native.near.sign_message`. When nothing is left
 *       switched on, or when run with `all`, it omits `native` from the policy, so every native
 *       method is off.
 * When: the owner no longer trusts a service, or wants the account back to the default.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, and `AGENT_SIGN_RECIPIENT` unless
 *        run with `all`.
 * Run: `pnpm 07:disable-native` (one service) or `pnpm 07:disable-native all` (everything)
 *
 * "All off" is spelled by omitting `native`. The change is on-chain like enabling it, and takes
 * effect once `/policy` is `APPLIED` and synced: the next request is then refused with
 * `signing_policy_denied` (NEP-413 signing) or `native_method_denied` (any other method). Signatures
 * already issued stay valid for whoever holds them: a login signature stays valid for as long as
 * the service accepts its nonce, and signed typed data or a signed transaction may stay usable until its own deadline.
 *
 * Revoking a grant also stops that grant from using native methods, without touching the policy.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { allOff, type NativeRules } from "../support/native.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** `recipient` removes one service; `null` turns every native method off. */
export async function disableNative(agentId: string, recipient: string | null) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const current = (await api.getPolicy(agentId)).policy?.native;
  if (!current) return { unchanged: "native methods are already off" };
  let remaining: NativeRules | null = null;
  if (recipient !== null) {
    if (!current.near.sign_message.includes(recipient))
      return { unchanged: `${recipient} is not listed` };
    const next = structuredClone(current);
    next.near.sign_message = next.near.sign_message.filter((entry) => entry !== recipient);
    remaining = allOff(next) ? null : next;
  }

  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(`Policy changes are throttled until ${availableAt}; run this after that.`);

  // The complete policy without `native`, or with the shorter list; everything else is unchanged.
  const request = await buildPolicyUpdate(api, agentId, ({ native: _removed, ...policy }) =>
    remaining === null ? policy : { ...policy, native: remaining },
  );
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);

  const after = await api.getPolicy(agentId);
  return {
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    status: after.status,
    provider_policy_synced: after.provider_policy_synced,
    native: after.policy?.native ?? "off: every native method is refused",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  const all = process.argv[2] === "all";
  const recipient = all ? null : required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([
    recipient === null
      ? "Turning every native method off…"
      : `Removing ${recipient} from the signing recipients…`,
  ]);
  void disableNative(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
