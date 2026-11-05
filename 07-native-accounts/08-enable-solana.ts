/**
 * Turn on Sign-In-With-Solana for one domain, and signed SOL transfers to one recipient.
 *
 * What: adds `AGENT_SIGN_RECIPIENT` (a lowercase domain such as `app.example.com`) to
 *       `native.solana.sign_in`, sets `native.solana.sign_transfer`, and when `destinations` is an
 *       allow list adds `AGENT_SOLANA_RECIPIENT` to it as a `withdraw` on chain `sol`. Every other
 *       switch keeps its value.
 * When: the agent logs in to a Solana dApp or service, or signs a SOL or token transfer that your
 *       backend broadcasts.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_SIGN_RECIPIENT`,
 *        `AGENT_SOLANA_RECIPIENT`.
 * Run: `pnpm 07:enable-solana`
 *
 * Both switches are bounded, unlike `solana.sign_message` (any bytes, which is full control of
 * the key's Intents account) and `solana.sign_transaction` (any transaction):
 * - `sign_in` lists domains. The API writes the sign-in message itself, so it can never be an
 *   Intents payload or a transaction.
 * - `sign_transfer` signs one SOL or SPL transfer whose recipient `destinations` allows as a
 *   `withdraw` on chain `sol` (no memo). Amounts, `assets`, `limits` and `budget` are not checked
 *   yet: this fences where funds go, not how much.
 *
 * It is an on-chain policy change (`nep366`) with the 10-minute cooldown.
 */
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { chainAddress } from "../support/destinations.js";
import { changePolicy, nativeOff, type NativeRules } from "../support/native.js";

export async function enableSolana(agentId: string, domain: string, recipient: string) {
  const result = await changePolicy(agentId, (policy) => {
    const native: NativeRules = structuredClone(policy.native ?? nativeOff);
    const domains = native.solana.sign_in ?? [];
    native.solana.sign_in = domains.includes(domain) ? domains : [...domains, domain];
    native.solana.sign_transfer = true;

    // `any` already allows the recipient and `except` allows what it does not list.
    const { destinations } = policy;
    const listed = destinations.list.some(
      (entry) =>
        entry.action === "withdraw" && entry.chain === "sol" && entry.address === recipient,
    );
    if (destinations.mode !== "only" || listed) return { ...policy, native };
    return {
      ...policy,
      native,
      destinations: {
        ...destinations,
        list: [...destinations.list, chainAddress({ chain: "sol", address: recipient })],
      },
    };
  });
  return result ?? { unchanged: "already switched on" };
}

if (isMainModule(import.meta.url)) {
  requireWrites("changing an agent's policy");
  const settings = config();
  const domain = required(settings.signRecipient, "AGENT_SIGN_RECIPIENT");
  const recipient = required(settings.solanaRecipient, "AGENT_SOLANA_RECIPIENT");
  banner([`Letting the agent sign in to ${domain} and sign SOL transfers to ${recipient}…`]);
  void enableSolana(required(settings.agentId, "AGENT_ID"), domain, recipient).then(print);
}
