/**
 * Turn on native methods: NEP-413 signing for one recipient, and EVM typed data for one domain.
 *
 * What: adds `AGENT_SIGN_RECIPIENT` to `native.near.sign_message`, and with `evm` also lists the
 *       example EIP-712 domain in `native.evm.sign_typed_data`. Every other switch keeps its value.
 * When: a service the owner trusts logs agents in by NEAR account (NEP-413), or an app the agent
 *       uses asks for EIP-712 signatures under one known domain.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_SIGN_RECIPIENT`.
 * Run: `pnpm 07:enable-native` (NEP-413 only) or `pnpm 07:enable-native evm` (also the domain)
 *
 * Native methods are off until the owner adds the `native` block. The wallet provider enforces it,
 * so this is an on-chain policy change (`nep366`, gas sponsored by the API). None of the money
 * rules (`destinations`, `budget`, `timelock_ms`, `schedule`, `owner_approval`) applies to native
 * requests: the switch is the whole fence. Show the owner a warning before they sign it.
 *
 * The NEAR Intents contracts (`intents.near`, `intents.far`) can never be listed: the API refuses
 * such a policy with `validation_failed`.
 */
import type { Policy } from "@near-intents-agent-api/sdk";
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { buildPolicyUpdate, waitForStatus } from "../support/flow.js";
import { isIntentsContract } from "../support/identity.js";
import { exampleDomain, nativeOff, type NativeRules } from "../support/native.js";
import { loadOwner } from "../support/near-owner.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** What your UI shows the owner before they sign a policy that turns on native methods. */
export const nativeWarning =
  "These switches let the agent use its own NEAR, EVM and Solana keys outside NEAR Intents. Your destinations, budget, delay, schedule and approval rules do not apply to them. A listed service may treat a signature as you logging in, and signed typed data or a signed transaction can move everything at that address. Only turn on what you trust.";

export async function enableNative(agentId: string, recipient: string, evm: boolean) {
  if (isIntentsContract(recipient))
    throw new Error(`${recipient} is a NEAR Intents contract; agents never sign for it`);
  const settings = config();
  const api = agentApi();
  const { keyPair } = loadOwner();

  const current = await api.getPolicy(agentId);
  const native: NativeRules = structuredClone(current.policy?.native ?? nativeOff);
  if (!native.near.sign_message.includes(recipient)) native.near.sign_message.push(recipient);
  if (evm && !native.evm.sign_typed_data.some((domain) => domain.name === exampleDomain.name))
    native.evm.sign_typed_data.push(exampleDomain);
  if (JSON.stringify(native) === JSON.stringify(current.policy?.native))
    return { unchanged: "already switched on", native };

  const { cooldowns } = await api.getAgent(agentId);
  const availableAt = cooldowns.policy_change_available_at;
  if (availableAt && Date.parse(availableAt) > Date.now())
    throw new Error(`Policy changes are throttled until ${availableAt}; run this after that.`);

  // The complete policy with the new `native` block; everything else is unchanged.
  const request = await buildPolicyUpdate(api, agentId, (policy): Policy => ({ ...policy, native }));
  const generated = await api.generateIntent(request, { idempotencyKey: crypto.randomUUID() });
  // Your UI shows `generated.preview` (it lists every switch that is on) and `nativeWarning` here,
  // then asks the owner to sign.
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const status = await waitForStatus(api, generated.correlation_id);
  if (status.status !== "SUCCESS")
    throw new Error(status.failure_code ?? `policy update ${status.status}`);

  // Native methods work once the revision is APPLIED and synced with the provider.
  const after = await api.getPolicy(agentId);
  return {
    warning_shown: nativeWarning,
    signed_with: generated.intent.standard,
    transaction_hash: status.type === "policy_update" ? status.details.transaction_hash : null,
    status: after.status,
    provider_policy_synced: after.provider_policy_synced,
    native: after.policy?.native,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  const recipient = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  const evm = process.argv[2] === "evm";
  banner([
    `Letting the agent sign NEP-413 messages for ${recipient}${evm ? ` and EIP-712 data for "${exampleDomain.name}"` : ""}…`,
  ]);
  void enableNative(required(settings.agentId, "AGENT_ID"), recipient, evm).then(print);
}
