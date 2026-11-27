/**
 * Let the agent's EVM key pay one payout the `sign_intent` rules do not list, with an owner signature.
 *
 * What: the owner signs a `payout_authorize` intent for one 1Click payout to `AGENT_WITHDRAW_ADDRESS`
 *       on Base; the grant client then gets a quote, has the EVM key sign the deposit with
 *       `payout_authorization_id` (`nativeEvmSignIntent`) and publishes `signed_data` to 1Click.
 * When: the agent should make a one-off payment to an address that is not in
 *       `sign_intent.withdrawals`, without a policy change.
 * Needs: `AGENT_ALLOW_WRITES=true`, owner keys, `AGENT_ID`, `AGENT_WITHDRAW_ADDRESS`, stored grant
 *        (`04:issue-grant`), `evm.sign_intent` on (`07:enable-sign-intent`, preferably without
 *        `AGENT_WITHDRAW_ADDRESS` so the address is not already listed). `AGENT_TOKEN` and
 *        `AGENT_TRANSFER_AMOUNT` (atomic units) are what the quote sells, from the agent's EVM
 *        Intents account (see `07:sign-intent-deposit`).
 * Run: `pnpm 07:payout-authorize`
 *
 * Without `AGENT_EXECUTE=true` this asks 1Click for a dry quote and prints the terms the owner
 * would sign. Nothing is signed.
 *
 * The authorization is the owner's consent to exactly one payout:
 * - `origin_asset`, `destination_asset`, `recipient` and `recipient_type` must equal the quote's;
 * - `amount_in` is a ceiling: the quote's `amountIn` may be lower (an exact-output quote fits);
 * - `min_amount_out` is a floor: the quote's `minAmountOut` may be higher;
 * - `valid_until` is 5 minutes to 24 hours ahead, and the payload's `deadline` (the quote's) must
 *   not be later, so a signed payload cannot be published after it.
 * The deposit it matches skips `receivers`, `withdrawals` and `one_click_deposits`. Everything else
 * still applies: 1Click's signature on the quote, the refund to the signer, `max_slippage_bps`, the
 * exact payment, a live grant and the `sign_intent` switch itself.
 *
 * The API binds the authorization to the first payload and grant it signs. Its status is
 * `PROCESSING` until then, `SUCCESS` with `details.signed_correlation_id` after, and `FAILED`
 * (`payout_authorization_expired`) if unused at `valid_until`. A refusal reads
 * `payout_authorization_invalid` (unknown, unsigned, spent, expired, for the other key), or
 * `policy_destination_denied` at `/payout_authorization_id` when no deposit matches the terms.
 *
 * Solana is the same with `key: "solana"` and `nativeSolanaSignIntent`.
 */
import { agentApi } from "../support/client.js";
import { banner, config, isMainModule, print, required, requireWrites } from "../support/config.js";
import { loadGrant } from "../support/grant-store.js";
import { loadOwner } from "../support/near-owner.js";
import { generateIntent, requestQuote, submitIntent, waitForSwap } from "../support/one-click.js";
import { signNearIntent } from "../support/sign-near-intent.js";

/** USDC on Base, as 1Click names it. */
const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export async function payoutAuthorize(agentId: string, execute: boolean) {
  const settings = config();
  const api = agentApi();
  const delegate = api.forGrant((await loadGrant(agentId)).token);

  if (!(await api.getPolicy(agentId)).policy?.native?.evm.sign_intent)
    throw new Error('native.evm.sign_intent is off; run "pnpm 07:enable-sign-intent"');
  const { evm_account_id } = await api.getWallet(agentId);
  if (!evm_account_id) throw new Error("The wallet provider has not reported an EVM address yet");
  // NEAR Intents spells the EVM account in lowercase; the API refuses a checksummed signer_id.
  const signer = evm_account_id.toLowerCase();
  const recipient = required(settings.withdrawAddress, "AGENT_WITHDRAW_ADDRESS").toLowerCase();

  const quoteInput = {
    signer,
    originAsset: settings.token,
    destinationAsset: baseUsdc,
    amount: settings.transferAmount,
    withdrawTo: recipient,
    // Clearly under the default `max_slippage_bps` of 100: fees count against the cap too.
    slippageBps: 50,
  };

  // A dry quote prices the payout, so the owner signs terms a live quote can meet.
  const dry = await requestQuote({ ...quoteInput, dry: true });
  const quoted = BigInt(required(dry.quote.minAmountOut, "the dry quote's minAmountOut"));
  const terms = {
    origin_asset: settings.token,
    // A ceiling: the live quote sells at most this.
    amount_in: settings.transferAmount,
    destination_asset: baseUsdc,
    // A floor, 1% under the dry quote's, so a live quote that moved a little still matches.
    min_amount_out: String((quoted * 99n) / 100n),
    recipient,
    recipient_type: "DESTINATION_CHAIN" as const,
  };
  if (!execute)
    return {
      dry_quote: dry.quote,
      payout_to_authorize: terms,
      note: "Dry run: nothing was signed. Set AGENT_EXECUTE=true to authorize, quote, sign and publish.",
    };

  // 1. The owner authorizes the payout. Do not wait for a final status (`runOwnerIntent` would):
  //    it reads `PROCESSING` until the agent uses it.
  const { keyPair } = loadOwner();
  const generated = await api.generateIntent(
    {
      type: "payout_authorize",
      agent_id: agentId,
      key: "evm",
      payout: terms,
      valid_until: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    { idempotencyKey: crypto.randomUUID() },
  );
  await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: await signNearIntent(generated, keyPair, settings.nearRpcUrl),
  });
  const authorization = await api.getStatus(generated.correlation_id);

  // 2. The agent pays it: a live quote that meets the terms, signed with the authorization's id.
  const quote = await requestQuote({ ...quoteInput, dry: false });
  const depositAddress = required(quote.quote.depositAddress, "the quote's depositAddress");
  const payload = await generateIntent(depositAddress, signer);
  const signed = await delegate.nativeEvmSignIntent(agentId, {
    payload,
    one_click_quotes: [quote],
    payout_authorization_id: generated.correlation_id,
  });

  // `signed_data` goes out as is: 1Click, `intents.near` (`execute_intents`) or a solver relay.
  const submitted = await submitIntent(signed.signed_data);
  const status = await waitForSwap(depositAddress);
  return {
    authorization: {
      correlation_id: generated.correlation_id,
      status: authorization.status,
      terms,
    },
    quote: quote.quote,
    signed: { correlation_id: signed.correlation_id, account_id: signed.account_id },
    submitted,
    status,
    // `SUCCESS` with `details.signed_correlation_id`: the authorization is spent.
    authorization_after: (await api.getStatus(generated.correlation_id)).status,
  };
}

if (isMainModule(import.meta.url)) {
  requireWrites("authorizing and signing a payout from the agent's EVM Intents account");
  const settings = config();
  banner([
    `${settings.execute ? "Authorizing and paying" : "Quoting (dry run)"}: ${settings.token} to Base USDC at ${settings.withdrawAddress}…`,
  ]);
  void payoutAuthorize(required(settings.agentId, "AGENT_ID"), settings.execute).then(print);
}
