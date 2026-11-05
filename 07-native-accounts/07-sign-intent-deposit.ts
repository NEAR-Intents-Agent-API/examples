/**
 * Swap or pay out from the agent's EVM Intents account with a signed 1Click deposit.
 *
 * What: gets a 1Click quote that refunds the agent's EVM Intents account, asks 1Click's
 *       `generate-intent` for the payload that pays the quote's deposit address, has the API sign
 *       it with the agent's EVM key (`nativeEvmSignIntent`) and publishes `signed_data` to 1Click.
 *       By default the swap stays inside Intents and pays the agent back; `withdraw` pays out to
 *       `AGENT_WITHDRAW_ADDRESS` on Base instead.
 * When: an agent trades or funds a venue from its EVM Intents account without the policy's
 *       `destinations`, `assets` and `limits`, under the owner's `sign_intent` rules.
 * Needs: `AGENT_ALLOW_WRITES=true`, `AGENT_ID`, `evm.sign_intent` on (`07:enable-sign-intent`),
 *        stored grant (`04:issue-grant`); for `withdraw`, `AGENT_WITHDRAW_ADDRESS` listed there.
 *        `AGENT_TOKEN` and `AGENT_TRANSFER_AMOUNT` (atomic units) are what the quote sells, from the
 *        agent's EVM Intents account; `AGENT_SWAP_TO` is what the swap buys.
 * Run: `pnpm 07:sign-intent-deposit` or `pnpm 07:sign-intent-deposit withdraw`
 *
 * Without `AGENT_EXECUTE=true` this asks 1Click for a dry quote (no deposit address) and stops.
 * With it, the example requests a real quote, signs and publishes: the account is debited.
 *
 * The balance is the EVM key's own NEAR Intents account (`wallet.evm_account_id`, lowercase), a
 * different account from the agent's NEAR one that `getBalances` reads. Fund it first, for
 * example with a 1Click deposit whose recipient is that address.
 *
 * Why the quote looks like this: the API signs only a transfer to a deposit address whose live
 * 1Click status shows `PENDING_DEPOSIT`, a refund to the signer, a payout to the signer or to a
 * listed `withdrawals` address, no `appFees`, `rebates` or custom messages, and slippage plus
 * 1Click's own fee (about 20 basis points for a swap) within `max_slippage_bps`. The payload must
 * pay exactly the quote's `amountIn`, and is due when the quote is, up to 96 hours ahead. A
 * signed payload can be published by anyone who holds it until then, and a freeze does not
 * recall it. The confidential form uses `CONFIDENTIAL_INTENTS` types and `intents.far`.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { generateIntent, requestQuote, submitIntent, waitForSwap } from "../support/one-click.js";

/** USDC on Base, as 1Click names it. */
const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export async function signIntentDeposit(agentId: string, withdraw: boolean, execute: boolean) {
  const settings = config();
  const api = agentApi();
  const delegate = api.forGrant((await loadGrant(agentId)).token);

  const rules = (await api.getPolicy(agentId)).policy?.native?.evm.sign_intent;
  if (!rules) throw new Error('native.evm.sign_intent is off; run "pnpm 07:enable-sign-intent"');
  const { evm_account_id } = await api.getWallet(agentId);
  if (!evm_account_id) throw new Error("The wallet provider has not reported an EVM address yet");
  // NEAR Intents spells the EVM account in lowercase; the API refuses a checksummed signer_id.
  const signer = evm_account_id.toLowerCase();

  const withdrawTo = withdraw
    ? required(settings.withdrawAddress, "AGENT_WITHDRAW_ADDRESS")
    : undefined;
  if (withdrawTo && !rules.withdrawals?.some((entry) => entry.address === withdrawTo.toLowerCase()))
    throw new Error(`${withdrawTo} is not in sign_intent.withdrawals; run 07:enable-sign-intent`);

  const quote = await requestQuote({
    dry: !execute,
    signer,
    originAsset: settings.token,
    destinationAsset: withdraw ? baseUsdc : settings.swapToToken,
    amount: settings.transferAmount,
    withdrawTo,
    // Slippage plus 1Click's own fee must stay within `max_slippage_bps` (100 by default).
    slippageBps: 75,
  });
  if (!execute)
    return {
      dry_quote: quote.quote,
      signer,
      note: "Dry run: nothing was signed. Set AGENT_EXECUTE=true to request a real quote, sign and publish.",
    };

  const depositAddress = required(quote.quote.depositAddress, "the quote's depositAddress");
  // 1Click writes the payload: one transfer of `amountIn` to the deposit address, due at the quote's deadline.
  const payload = await generateIntent(depositAddress, signer);
  const signed = await delegate.nativeEvmSignIntent(agentId, { payload });

  // `signed_data` goes out as is. intents.near (`execute_intents`) or a solver relay take it too.
  const submitted = await submitIntent(signed.signed_data);
  const status = await waitForSwap(depositAddress);
  return {
    quote: quote.quote,
    signed: { correlation_id: signed.correlation_id, account_id: signed.account_id },
    submitted,
    status,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("signing a payment from the agent's EVM Intents account");
  const settings = config();
  const withdraw = process.argv[2] === "withdraw";
  banner([
    `${settings.execute ? "Signing and publishing" : "Quoting (dry run)"}: ${withdraw ? `${settings.token} to Base USDC at ${settings.withdrawAddress}` : `${settings.token} to ${settings.swapToToken} inside Intents`}…`,
  ]);
  void signIntentDeposit(required(settings.agentId, "AGENT_ID"), withdraw, settings.execute).then(
    print,
  );
}
