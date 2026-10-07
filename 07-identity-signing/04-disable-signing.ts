/**
 * Turn identity signing off, for one service or entirely.
 *
 * What: removes `AGENT_SIGN_RECIPIENT` from `sign.recipients`. When it is the last recipient, or
 *       when run with `all`, it omits `sign` from the policy, so the agent signs nothing.
 * When: the owner no longer trusts a service, or wants the account back to the default.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, and `AGENT_SIGN_RECIPIENT` unless
 *        run with `all`.
 * Run: `pnpm 07:disable-signing` (one service) or `pnpm 07:disable-signing all` (every service)
 *
 * `sign` needs at least one recipient, so "no recipients" is spelled by omitting the field. The
 * change is on-chain like enabling it, and takes effect once `/policy` is `APPLIED` and synced:
 * the next `sign` request is then refused with `policy_action_denied` (no `sign`) or
 * `signing_policy_denied` (recipient removed). Signatures already issued stay valid for the
 * relying party until their challenge expires (at most 5 minutes).
 *
 * Revoking a grant also stops that grant from signing, without touching the policy.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** `recipient` removes one service; `null` turns signing off for every service. */
export async function disableSigning(agentId: string, recipient: string | null) {
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const current = await api.getPolicy(agentId);
  const listed = current.policy?.sign?.recipients ?? [];
  const remaining = recipient === null ? [] : listed.filter((entry) => entry !== recipient);
  if (remaining.length === listed.length)
    return {
      unchanged: recipient === null ? "signing is already off" : `${recipient} is not listed`,
    };

  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(`Policy changes are throttled until ${availableAt}; run this after that.`);

  // The complete policy without `sign`, or with the shorter list; everything else is unchanged.
  const request = await buildPolicyUpdate(api, agentId, ({ sign: _removed, ...policy }) =>
    remaining.length === 0 ? policy : { ...policy, sign: { recipients: remaining } },
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
    sign: after.policy?.sign ?? "off: the agent signs nothing",
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  const all = process.argv[2] === "all";
  const recipient = all ? null : required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([
    recipient === null
      ? "Turning identity signing off for every service…"
      : `Removing ${recipient} from the signing recipients…`,
  ]);
  void disableSigning(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
