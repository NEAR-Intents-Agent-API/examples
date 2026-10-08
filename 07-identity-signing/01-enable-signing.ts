/**
 * Turn on identity signing for one service.
 *
 * What: adds `AGENT_SIGN_RECIPIENT` to the policy rule `sign: { recipients }`, so any grant on the
 *       account may have the agent prove to that service that it controls the account.
 * When: a service the owner trusts logs agents in by NEAR account (NEP-413), for example a data
 *       provider or another agent platform.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_SIGN_RECIPIENT`.
 * Run: `pnpm 07:enable-signing`
 *
 * Signing is off until the owner adds `sign`. The wallet provider enforces the same recipient
 * list, so this is an on-chain policy change (`nep366`, gas sponsored by the API). Show the owner a
 * warning before they sign it: a listed service may treat the signature as the account logging in.
 *
 * The NEAR Intents contracts (`intents.near`, `intents.far`) can never be recipients: the API
 * refuses such a policy with `validation_failed`. Signing moves no value, so `timelock_ms`,
 * `schedule`, `budget` and `owner_approval` do not apply to it.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { isIntentsContract } from "../support/identity.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** What your UI shows the owner before they sign a policy that adds `sign`. */
export const signingWarning =
  "Agents can prove they control this account to the listed services. Only add services you trust; a service may treat that proof as you logging in.";

export async function enableSigning(agentId: string, recipient: string) {
  if (isIntentsContract(recipient))
    throw new Error(`${recipient} is a NEAR Intents contract; agents never sign for it`);
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const current = await api.getPolicy(agentId);
  const listed = current.policy?.sign?.recipients ?? [];
  if (listed.includes(recipient))
    return { unchanged: `${recipient} is already listed`, sign: current.policy?.sign };

  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(`Policy changes are throttled until ${availableAt}; run this after that.`);

  // The complete policy with one more signing recipient; everything else is unchanged.
  const request = await buildPolicyUpdate(api, agentId, (policy) => ({
    ...policy,
    sign: { recipients: [...listed, recipient] },
  }));
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  // Your UI shows `generated.preview` and `signingWarning` here, then asks the owner to sign.
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);

  // Signing works once the revision is APPLIED and synced with the provider.
  const after = await api.getPolicy(agentId);
  return {
    warning_shown: signingWarning,
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    status: after.status,
    provider_policy_synced: after.provider_policy_synced,
    sign: after.policy?.sign,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  const recipient = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  banner([`Letting the agent sign identity challenges for ${recipient}…`]);
  void enableSigning(required(settings.agentId, "AGENT_ID"), recipient).then(print);
}
